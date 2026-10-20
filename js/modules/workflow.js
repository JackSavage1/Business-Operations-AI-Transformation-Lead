/* Throughline: Workflow Mapper (#workflow).
 *
 * Owns the shared process library (OPS.processes) with a current state and a redesigned future
 * state for four core workflows, plus OPS.workflow helpers (edited steps, flow metrics) that the
 * SOP builder and other pages reuse. Volumes come from the synthetic operating data so the maps
 * agree with the dashboards; timings are discovery estimates marked as examples.
 */
(function () {
  "use strict";
  const OPS = window.OPS;
  const UI = window.UI;
  if (!OPS || !UI || !OPS.data || !OPS.q) return;
  const D = OPS.data;
  const Q = OPS.q;

  // ---------------------------------------------------------------------------------------------
  // Facts pulled from the operating data (last 4 weeks scaled to a month; rates over 12 weeks)
  // ---------------------------------------------------------------------------------------------
  const F = (function () {
    const k = 52 / 12 / 4;
    const f4 = Q.funnel({ from: 22, to: 25 });
    const f12 = Q.funnel({ from: 14, to: 25 });
    const cw = D.callCenter.weekly;
    const avg = (a, fn) => (a.length ? a.reduce((s, x) => s + fn(x), 0) / a.length : 0);
    const pre = cw.filter((w) => w.weekIndex < 13);
    const post = cw.filter((w) => w.weekIndex >= 13);
    const ap = D.appointments;
    const ag = D.callCenter.agents;
    const teams = D.callCenter.teams;
    const eng = ag.filter((a) => a.team === teams[0]).length;
    const bil = ag.filter((a) => a.team === teams[1]).length;
    const r10 = (v) => Math.max(10, Math.round(v / 10) * 10);
    const r2 = (v) => Math.round(v * 100) / 100;
    const hou = Q.funnel({ market: "hou", from: 13, to: 25 });
    const net = Q.funnel({ from: 13, to: 25 });
    const spanish = ap.filter((a) => a.language === "Spanish").length / Math.max(1, ap.length);
    return {
      r10, r2,
      assigned: r10(f4.assigned * k),
      attempts: r10(f4.attempts * k),
      reached: r10(f4.reached * k),
      scheduled: r10(f4.scheduled * k),
      noShows: r10(f4.noShows * k),
      completed: r10(f4.completed * k),
      charts: r10(f4.chartsSubmitted * k),
      passed: r10(f4.chartsPassedQA * k),
      attemptsPerMember: f4.attempts / Math.max(1, f4.assigned),
      contactRate: f4.contactRate,
      scheduleRate: f4.scheduleRate,
      showRate: f12.showRate,
      noShowRate: r2(f12.noShowRate),
      qaBounce: r2(1 - f12.qaPassRate),
      ahtPre: avg(pre, (w) => w.ahtSec),
      ahtPost: avg(post, (w) => w.ahtSec),
      acwPre: avg(pre, (w) => w.acwSec),
      acwPost: avg(post, (w) => w.acwSec),
      leadDays: avg(ap, (a) => a.leadDays),
      spanishShare: spanish,
      callbackShare: r2(spanish * (eng / Math.max(1, eng + bil))),
      docMin: Math.round(avg(D.clinicians, (c) => c.avgDocMin)),
      chartLag: Math.round(avg(D.clinicians, (c) => c.chartLagHrs)),
      houSched: hou.scheduleRate,
      netSched: net.scheduleRate,
      agents: ag.length,
      bilingual: bil,
      clinicians: D.clinicians.length,
    };
  })();
  const pct0 = (v) => UI.fmt.pct(v, 0);
  const talkMin = Math.round(((F.ahtPost - F.acwPost) / 60) * 10) / 10;
  const acwMin = Math.round((F.acwPost / 60) * 10) / 10;
  const callbackVol = F.r10(F.reached * F.callbackShare);
  const bounceVol = F.r10(F.charts * F.qaBounce);
  const noShowLater = F.r2(F.noShowRate * 0.7);

  // ---------------------------------------------------------------------------------------------
  // Process library
  // Step fields: id, lane, name, system, touchMin (per unit), waitHrs (queue before the step),
  // reworkPct (share repeated), volumePerMonth, manual, handoff (work changes hands entering the
  // step), decision, pathPct (share of units that pass through; 1 = every unit), parallel (runs
  // alongside the previous step), rules / judgment (0–1, for automation fit), note, questions.
  // Future steps add change + rationale and may inherit from a current step via `from`.
  // ---------------------------------------------------------------------------------------------
  const PROCESSES = [
    {
      id: "scheduling",
      code: "SCH",
      name: "Member outreach to scheduled visit",
      short: "Outreach to visit",
      dept: "Scheduling",
      owner: "Scheduling lead",
      ownerLane: "sched",
      unit: "member",
      volUnit: "members",
      leadLabel: "file received to visit day, per member",
      kpi: "Schedule conversion",
      trigger: "A health plan sends an eligibility and care-gap file",
      outcome: "The member is seen, or a missed visit is rebooked the same day",
      say: "The biggest block of lead time is the wait for a visit date, which is a clinician-capacity question for the Capacity Planner. The waste the outreach team controls is the two-day file load, the four-day contact queue, the Spanish callback list and the re-keying, and that is what the redesign removes.",
      lanes: [
        { id: "plan", name: "Health plan", kind: "external", lead: "Plan account manager", dept: "Customer success", headcount: 0 },
        { id: "agent", name: "Outreach agent", kind: "internal", lead: "Call center manager", dept: "Call center", headcount: F.agents - 4 },
        { id: "sched", name: "Scheduler", kind: "internal", lead: "Scheduling lead", dept: "Scheduling", headcount: 4 },
        { id: "member", name: "Member", kind: "external", lead: "Member", dept: "Scheduling", headcount: 0 },
        { id: "clin", name: "Clinician", kind: "internal", lead: "Clinical manager", dept: "Clinical", headcount: F.clinicians },
      ],
      purpose: "Turn every eligible member on a health-plan file into a completed visit with as few touches and delays as possible, and recover missed visits the same day.",
      scope: {
        in: ["All plans and markets served by the outreach and scheduling teams", "Outbound and inbound scheduling calls, reminders, and no-show recovery", "In-home and telehealth assessments and care-gap visits"],
        out: ["Clinical content of the visit (covered by clinical SOPs)", "Clinician capacity planning and route design", "Plan contract terms and outreach caps"],
      },
      phiStores: ["CRM member record", "Scheduling system", "Dialer", "Two-way SMS platform (BAA in place; no clinical detail in texts)"],
      phiShare: "a CRM task on the member record",
      phi: [
        "Verify identity with plan member ID and date of birth. Never read a full Medicare or Social Security number aloud.",
        "Call notes carry what the next person needs: intent, barriers, follow-up. Leave out unrelated health history.",
        "Reminder texts name the visit type and time only. No diagnoses, care gaps, or plan details in SMS.",
      ],
      exceptions: [
        { when: "Member reports chest pain, trouble breathing, or another urgent symptom", then: "Tell the member to call 911, warm-transfer to the on-call RN line, and record the escalation", owner: "Outreach agent, then on-call RN", within: "Immediately" },
        { when: "Member asks to stop calls or threatens a complaint", then: "Mark do-not-call, apologize, and route to a supervisor for review", owner: "Call center supervisor", within: "Same day" },
        { when: "Member has died, moved out of the service area, or changed plans", then: "Disposition as a roster update and do not schedule; the Finance roster queue picks it up", owner: "Finance analyst", within: "Next roster cycle" },
        { when: "A Spanish-preferred member has waited more than 4 business hours", then: "Workforce manager reassigns bilingual agents or approves overtime", owner: "Workforce manager", within: "4 business hours", only: "future" },
        { when: "An AI-drafted note has low confidence or the agent disagrees with it", then: "Agent rewrites the note; the draft goes to the QA sample", owner: "Call center QA", within: "Same shift", only: "future" },
        { when: "Scheduling API or SMS platform is down", then: "Book in the manual fallback log; schedulers back-enter within 24 hours", owner: "Scheduling lead", within: "24 hours", only: "future" },
      ],
      kpis: [
        { name: "Schedule conversion (reached to scheduled)", today: pct0(F.scheduleRate), target: "+3 pts within 60 days", source: "Ops Command Center, weekly" },
        { name: "Houston schedule conversion", today: pct0(F.houSched), target: "Within 5 pts of network", source: "Ops Command Center, weekly" },
        { name: "No-show rate", today: pct0(F.noShowRate), target: "Under " + pct0(noShowLater), source: "Scheduling system, weekly" },
        { name: "After-call work per call", today: UI.fmt.mmss(F.acwPost), target: "Under 1:00", source: "Dialer and CRM, daily" },
      ],
      current: [
        { id: "c1", lane: "plan", name: "Send eligibility and care-gap file", system: "SFTP", touchMin: 0, waitHrs: 0, volumePerMonth: 16, volUnit: "files", manual: false,
          rules: 0.9, judgment: 0.1,
          note: "Four plans send weekly files in four different layouts. Adds, terms, and open care gaps arrive together.",
          questions: ["Which plans send full files and which send changes only, and how often does a layout change without notice?", "What share of records arrive without a usable phone number or language preference?", "Who at each plan do we call when a file is late or malformed?"] },
        { id: "c2", lane: "agent", name: "Clean the file in Excel and load the call list into the dialer", system: "Excel, dialer import", touchMin: 90, waitHrs: 48, reworkPct: 0.12, volumePerMonth: 16, volUnit: "files", manual: true, batch: true,
          rules: 0.9, judgment: 0.15, fitWhy: "Same cleanup every time: rename columns, fix phone formats, drop termed rows.", phiGap: "Plan files are opened and edited in local Excel copies.",
          note: "A team lead reformats each file by hand. Loads wait for a free afternoon, and about 1 in 8 imports is rejected and redone.",
          questions: ["Walk me through the last file you loaded: which columns did you fix by hand?", "What happens when the import fails, and who notices?", "How many members sat in the file before their first call last week?"] },
        { id: "c3", lane: "agent", name: "Dialer attempts until the member answers", system: "Dialer", touchMin: 0.3, waitHrs: 96, volumePerMonth: F.attempts, volUnit: "attempts", manual: false,
          rules: 0.8, judgment: 0.2,
          note: "About " + UI.fmt.dec(F.attemptsPerMember, 1) + " attempts per assigned member and a " + pct0(F.contactRate) + " contact rate. New members queue behind retries, so first contact takes about 4 days.",
          questions: ["How does the dialer decide who gets called first: file order, retries, or care-gap value?", "What contact rate do you see by time of day and day of week?", "How many attempts before a member is closed as unreachable, and who set that rule?"] },
        { id: "c4", lane: "agent", name: "Connected call: verify identity, explain the visit, offer slots", system: "Dialer, CRM, scheduling system (view only)", touchMin: talkMin, waitHrs: 0, volumePerMonth: F.reached, volUnit: "connects", manual: true,
          rules: 0.3, judgment: 0.7, kpi: "Schedule conversion",
          note: "Talk and hold time averages " + UI.fmt.mmss(F.ahtPost - F.acwPost) + " since W14. Agents read open slots from a second screen because the CRM and the scheduling system do not talk.",
          questions: ["Which objections come up most, and which ones end the call?", "How do you find an open slot near the member while they are on the line?", "When does the member hear a confirmed time: on the call, or after the scheduler books it?"] },
        { id: "c5", lane: "member", name: "Accepts a visit?", system: "Phone", touchMin: 0, waitHrs: 0, volumePerMonth: F.reached, volUnit: "connects", manual: false, decision: true,
          rules: 0.2, judgment: 0.9,
          note: pct0(F.scheduleRate) + " of reached members schedule. Houston converts at " + pct0(F.houSched) + " against " + pct0(F.netSched) + " network-wide since W14.",
          questions: ["Of the members who decline, how many say they already saw their PCP this year?", "Do members offered a specific time convert better than members asked for a preference?"] },
        { id: "c6", lane: "agent", name: "Spanish-preferred member goes on a callback list", system: "Shared Excel callback sheet", touchMin: 10, waitHrs: 96, reworkPct: 0.35, pathPct: F.callbackShare, volumePerMonth: callbackVol, volUnit: "members", manual: true, handoff: true,
          rules: 0.85, judgment: 0.2, kpi: "Schedule conversion (Houston)", phiGap: "Member names and phone numbers sit in a shared spreadsheet outside the CRM.",
          note: "English-only agents log Spanish-preferred members to a shared sheet for the " + F.bilingual + "-person bilingual team. Callbacks take about 4 days, and about a third need another try.",
          questions: ["How many names are on the callback sheet right now, and how old is the oldest?", "Does the plan file carry a language flag we could route on before the first call?", "What share of callbacks end in a scheduled visit, compared with first-call bilingual contacts?"] },
        { id: "c7", lane: "agent", name: "Type free-text call notes and pick a disposition", system: "CRM", touchMin: acwMin, waitHrs: 0, volumePerMonth: F.reached, volUnit: "connects", manual: true, handoff: false,
          rules: 0.6, judgment: 0.4, text: true, kpi: "After-call work (sec)",
          note: "After-call work rose from " + UI.fmt.mmss(F.acwPre) + " to " + UI.fmt.mmss(F.acwPost) + " after the W14 scheduling-system change, because agents now write up the visit request in the CRM for the scheduler.",
          questions: ["Which parts of the note does anyone downstream actually read?", "How often is the disposition wrong or missing when QA reviews calls?", "What do you type that the system already knows?"] },
        { id: "c8", lane: "sched", name: "Re-key the visit request into the scheduling system and book the slot", system: "Scheduling system", touchMin: 4.5, waitHrs: 6, reworkPct: 0.08, volumePerMonth: F.scheduled, volUnit: "visits", manual: true,
          rules: 0.95, judgment: 0.1, kpi: "Booking errors", fitWhy: "It copies the same fields from one system to another for every booked visit.",
          note: "Double entry since the W14 system change. Schedulers copy name, address, plan ID, visit type, and slot from the CRM request; about 8% need a fix or a call back to the member.",
          questions: ["Which fields do you copy by hand, and which ones go wrong most often?", "How long does a request sit in the queue before you book it, and what happens if the slot is gone?", "Was the CRM to scheduling-system integration scoped at go-live, and who owns that backlog?"] },
        { id: "c9", lane: "sched", name: "Send a one-way reminder text two days before the visit", system: "SMS tool (CSV upload)", touchMin: 0.4, waitHrs: 0, volumePerMonth: F.scheduled, volUnit: "visits", manual: true, handoff: false,
          rules: 0.9, judgment: 0.1, kpi: "Show rate",
          note: "Reminders go out in a daily CSV batch. One-way texts cannot capture a confirmation or a cancellation, so nobody knows which slots will be empty.",
          questions: ["Which members get no reminder at all, and why?", "Can members reply to the text today, and where do the replies go?", "How far ahead does a cancellation need to arrive for us to backfill the slot?"] },
        { id: "c10", lane: "member", name: "Waits for the visit date", system: "None", touchMin: 0, waitHrs: Math.round(F.leadDays * 24), volumePerMonth: F.scheduled, volUnit: "visits", manual: false,
          rules: 0.2, judgment: 0.5,
          note: "Average " + UI.fmt.dec(F.leadDays, 1) + " days from booking to visit, longer in Phoenix and Charlotte. This is a clinician-capacity lever covered in the Capacity Planner.",
          questions: ["How does the no-show rate change once lead time passes two weeks?", "Which markets run out of slots first, and on which days?"] },
        { id: "c11", lane: "clin", name: "Arrive for the visit and find a no-show at the door", system: "Clinician mobile app", touchMin: 40, waitHrs: 0, pathPct: F.noShowRate, volumePerMonth: F.noShows, volUnit: "no-shows", manual: true,
          rules: 0.5, judgment: 0.5, kpi: "Show rate",
          note: pct0(F.noShowRate) + " of scheduled visits are no-shows, found on the doorstep. The drive and the wait are lost, and the slot cannot be refilled.",
          questions: ["How long do you wait at the door before marking a no-show?", "What do you do with the open slot today?", "Which of last week's no-shows could we have predicted the day before?"] },
        { id: "c12", lane: "sched", name: "Reschedule no-shows from the clinician's end-of-day email", system: "Email, scheduling system", touchMin: 6, waitHrs: 24, pathPct: F.noShowRate, volumePerMonth: F.noShows, volUnit: "no-shows", manual: true,
          rules: 0.7, judgment: 0.3, phiGap: "No-show lists with member names travel by email.",
          note: "Clinicians email their no-shows at the end of the day, and schedulers start calling the next morning.",
          questions: ["What share of no-shows rebook within 7 days today?", "Who owns the member after a no-show: outreach or scheduling?"] },
      ],
      future: [
        { id: "f1", from: "c1", change: "Unchanged", rationale: "Plans keep sending files the way they do today; the change happens on our side of the SFTP." },
        { id: "f2", from: "c2", change: "Automated", name: "Automated intake validates, normalizes, and loads the call list", system: "Scheduled job (n8n), dialer API", touchMin: 10, waitHrs: 2, reworkPct: 0.02, manual: false,
          rationale: "A scheduled job checks the layout, standardizes fields, and loads the dialer within 2 hours; a person reviews only rejected rows.",
          questions: ["Which validation rules block a load, and which only warn?", "Who gets alerted when a file is late or a layout changes?"] },
        { id: "f3", from: "c3", change: "Automated", name: "Dialer calls by priority: care-gap value, language, best time to call", waitHrs: 48, volumePerMonth: F.r10(F.attempts * 0.9),
          rationale: "Attempt order uses care-gap value and past answer times, so new members get a first call within a day instead of queuing behind retries.",
          questions: ["How do we confirm the new order does not starve hard-to-reach members?", "What contact-rate lift will we accept as proof after two weeks?"] },
        { id: "f4", from: "c4", change: "Unchanged", name: "Connected call: verify, explain, and book the slot on the call", system: "Dialer, CRM with scheduling API", touchMin: Math.round((talkMin + 0.4) * 10) / 10,
          rationale: "The conversation stays human. The agent books through the scheduling API while the member is on the line, which adds about 25 seconds and removes the re-key." },
        { id: "f5", from: "c5", change: "Unchanged", rationale: "The member still decides; a confirmed time on the call is expected to lift conversion, which the pilot will measure." },
        { id: "f6", from: "c6", change: "Automated", name: "Spanish-preferred members route straight to the bilingual queue", system: "Dialer routing rules, CRM language flag", touchMin: 8, waitHrs: 2, reworkPct: 0.1, handoff: false,
          rationale: "The plan's language flag and a first-call language tag route members to bilingual agents, with a 4-business-hour callback SLA.",
          questions: ["Do we have enough bilingual agents at peak hours to hold a 4-hour SLA?", "How accurate is the plan's language flag against what members tell us?"] },
        { id: "f7", from: "c7", change: "AI-assisted", name: "Claude drafts the call summary and disposition; the agent confirms", system: "CRM with Claude (under BAA)", touchMin: 0.9, reworkPct: 0.05,
          rationale: "The model drafts the note and disposition from the call; the agent edits or confirms in one click, and low-confidence drafts go to QA review.",
          questions: ["What confidence threshold sends a draft to QA, and who samples the rest?", "How will we measure note accuracy before turning this on for every agent?", "Which fields must the agent always confirm by hand?"] },
        { id: "f8", from: "c8", change: "Eliminated", rationale: "Booking happens on the call through the scheduling API, so there is nothing to re-key." },
        { id: "f9", from: "c9", change: "Automated", name: "Risk-based reminders: two-way text for all, live call for high risk", system: "Two-way SMS platform, no-show risk score", touchMin: 0.6, manual: false, handoff: false,
          rationale: "A nightly risk score sends every member a two-way text; schedulers call only high-risk members who have not confirmed 48 hours out.",
          questions: ["Which risk threshold triggers a live call, and how many calls a day does that create?", "How do replies like 'cancel' or 'change time' reach a scheduler?"] },
        { id: "f10", from: "c10", change: "Unchanged", rationale: "Calendar lead time is a clinician-capacity lever, handled in the Capacity Planner rather than in this redesign." },
        { id: "f11", from: "c11", change: "Unchanged", name: "Arrive for the visit; no-show at the door (less often)", pathPct: noShowLater, volumePerMonth: F.r10(F.scheduled * noShowLater),
          note: "Confirmed visits no-show far less often, and unconfirmed slots release to a standby list the day before.",
          rationale: "Still happens, about 30% less often, because two-way confirmation flags empty slots a day ahead." },
        { id: "f12", from: "c12", change: "Automated", name: "Same-hour reschedule text after a no-show; scheduler handles replies", system: "Clinician app, two-way SMS, scheduling system", touchMin: 2, waitHrs: 1, pathPct: noShowLater, volumePerMonth: F.r10(F.scheduled * noShowLater),
          rationale: "The clinician marks the no-show in the app, which sends a reschedule link within the hour; schedulers handle replies only.",
          questions: ["What share of members rebook from the link without a call?", "When does a no-show member go back to the outreach queue instead?"] },
      ],
    },
    {
      id: "chart-to-cash",
      code: "C2C",
      name: "Visit to chart QA to billing",
      short: "Chart to cash",
      dept: "Clinical",
      owner: "Coding & QA lead",
      ownerLane: "qa",
      unit: "chart",
      volUnit: "charts",
      leadLabel: "visit complete to encounter accepted, per chart",
      kpi: "QA first-pass rate",
      trigger: "A clinician completes a visit",
      outcome: "The encounter is accepted by the health plan and billable",
      say: "A chart that passes QA on Monday waits for Friday's batch. Catching missing fields at sign-off and sending a nightly batch is worth more than any coder productivity push, and the remaining wait sits with the plan.",
      lanes: [
        { id: "clin", name: "Clinician", kind: "internal", lead: "Clinical director", dept: "Clinical", headcount: F.clinicians },
        { id: "qa", name: "QA coder", kind: "internal", lead: "Coding & QA lead", dept: "Clinical", headcount: 7 },
        { id: "bill", name: "Billing", kind: "internal", lead: "Billing manager", dept: "Finance", headcount: 3 },
        { id: "plan", name: "Health plan", kind: "external", lead: "Plan encounter-data team", dept: "Finance", headcount: 0 },
      ],
      purpose: "Move every completed visit to an accepted, billable encounter quickly and accurately, with documentation that holds up to plan audits and HEDIS and risk-adjustment review.",
      scope: {
        in: ["In-home and telehealth assessments and care-gap visits for all contracted plans", "Chart documentation, sign-off, coding QA, encounter submission, and rejection work", "Plan acknowledgement (277CA) handling"],
        out: ["Clinical decision-making during the visit", "Payment posting and plan invoicing", "Provider credentialing"],
      },
      phiStores: ["EHR", "EHR task queue", "Clearinghouse portal", "QA worklist inside the EHR"],
      phiShare: "an EHR task on the chart",
      phi: [
        "Coders and billers open only the charts in their queue; no bulk exports of charts to local drives.",
        "Bounce reasons go in the EHR task, never in email or chat.",
        "AI-drafted narratives are generated inside the BAA-covered workspace and are reviewed and signed by the clinician.",
      ],
      exceptions: [
        { when: "Chart documents an urgent clinical finding not yet acted on", then: "Coder alerts the clinical manager through the EHR urgent-task flag", owner: "Clinical manager", within: "Same day" },
        { when: "A chart is still unsigned 24 hours after the visit", then: "Automated reminder to the clinician; manager follow-up at 48 hours", owner: "Clinical manager", within: "48 hours" },
        { when: "Encounter rejections approach the plan's timely-filing limit", then: "Senior biller works the item first and flags it in the weekly revenue review", owner: "Billing manager", within: "5 business days before the limit" },
        { when: "A clinician's QA pass rate drops below 90% in a month", then: "Move the clinician to 100% review and schedule documentation coaching", owner: "Coding & QA lead", within: "Next week", only: "future" },
      ],
      kpis: [
        { name: "QA first-pass rate", today: UI.fmt.pct(1 - F.qaBounce, 0), target: "97% or better", source: "QA worklist, weekly" },
        { name: "Chart close lag", today: F.chartLag + " hrs", target: "Same day (under 8 hrs)", source: "EHR, daily" },
        { name: "QA pass to encounter submitted", today: "3.5 days", target: "Under 1 day", source: "Clearinghouse, weekly" },
        { name: "Encounter rejection rate", today: "4.0%", target: "Under 1.5%", source: "277CA files, weekly" },
      ],
      current: [
        { id: "c1", lane: "clin", name: "Document the assessment in the EHR", system: "EHR", touchMin: F.docMin, waitHrs: 0, volumePerMonth: F.completed, volUnit: "visits", manual: true,
          rules: 0.3, judgment: 0.7, text: true, kpi: "Documentation minutes per visit",
          note: "Average " + F.docMin + " minutes per chart; new clinicians in Tampa take closer to 40.",
          questions: ["Which sections take longest to document, and which are copied from the last visit?", "What do you document after the visit that you could capture during it?", "Which required HEDIS or HCC fields are easiest to miss?"] },
        { id: "c2", lane: "clin", name: "Close and sign the chart", system: "EHR", touchMin: 4, waitHrs: F.chartLag, volumePerMonth: F.completed, manual: true,
          rules: 0.6, judgment: 0.4, kpi: "Chart close lag (hrs)",
          note: "Charts close " + F.chartLag + " hours after the visit on average; new clinicians run 40 to 60 hours because they close in end-of-week batches.",
          questions: ["When in your day do you close charts, and what stops you from closing them right after the visit?", "Do late charts cluster by clinician, market, or visit type?"] },
        { id: "c3", lane: "qa", name: "QA review: codes, HEDIS fields, signatures", system: "EHR, QA tracker (Excel)", touchMin: 12, waitHrs: 24, reworkPct: F.qaBounce, volumePerMonth: F.charts, manual: true,
          rules: 0.7, judgment: 0.5, kpi: "QA first-pass rate", phiGap: "The QA tracker spreadsheet lists member names and chart IDs.",
          note: "Every chart gets a full review. About " + pct0(F.qaBounce) + " bounce back for missing or inconsistent fields.",
          questions: ["Which five bounce reasons cover most rejections?", "Which checks are pure rules (field present, code valid) and which need coder judgment?", "How long does a chart wait in the QA queue on a Monday compared with a Thursday?"] },
        { id: "c4", lane: "clin", name: "Fix the bounced chart", system: "EHR, email", touchMin: 15, waitHrs: 30, pathPct: F.qaBounce, volumePerMonth: bounceVol, manual: true,
          rules: 0.6, judgment: 0.4, phiGap: "Bounce notices with chart details are sent by email.",
          note: "QA emails the clinician, who fixes the chart between visits or at the end of the week.",
          questions: ["How do you find out a chart bounced, and how many are waiting for you now?", "Which fixes could QA make without sending the chart back?"] },
        { id: "c5", lane: "qa", name: "Re-review the corrected chart", system: "EHR, QA tracker (Excel)", touchMin: 8, waitHrs: 16, pathPct: F.qaBounce, volumePerMonth: bounceVol, manual: true,
          rules: 0.8, judgment: 0.3,
          note: "A second full review, often by a different coder than the first.",
          questions: ["Does the re-review check only the fixed fields or the whole chart?", "How often does a chart bounce a second time?"] },
        { id: "c6", lane: "bill", name: "Key codes into the weekly encounter batch", system: "Clearinghouse portal, Excel", touchMin: 2.5, waitHrs: 84, reworkPct: 0.03, volumePerMonth: F.passed, manual: true,
          rules: 0.95, judgment: 0.1, kpi: "Days from QA pass to submission", fitWhy: "It copies coded fields from one system to another on a fixed schedule.",
          note: "Billing copies codes from the QA tracker and submits one 837 batch per plan on Fridays, so a chart that passes QA on Monday waits most of a week.",
          questions: ["Why weekly: a plan requirement, clearinghouse cost, or habit?", "Which fields do you key by hand that already exist in the EHR?", "How do you reconcile what was billed against what passed QA?"] },
        { id: "c7", lane: "plan", name: "Process encounters and return acknowledgements (277CA)", system: "Plan claims system", touchMin: 0, waitHrs: 72, reworkPct: 0.04, volumePerMonth: F.passed, manual: false,
          rules: 0.5, judgment: 0.3,
          note: "About 4% of encounters come back rejected on front-end edits: member ID, NPI, or date mismatches.",
          questions: ["Which rejection codes repeat across plans?", "Does each plan publish its front-end edit rules, and do we test against them before submitting?"] },
        { id: "c8", lane: "bill", name: "Work rejections and resubmit", system: "Clearinghouse portal, Excel", touchMin: 14, waitHrs: 72, pathPct: 0.04, volumePerMonth: F.r10(F.passed * 0.04), manual: true,
          rules: 0.7, judgment: 0.4, kpi: "Encounter rejection rate",
          note: "Billers research each rejection by hand and resubmit with the next weekly batch.",
          questions: ["What share of rejections are fixed without contacting the clinician?", "How many rejections age past the plan's timely-filing window each quarter?"] },
      ],
      future: [
        { id: "f1", from: "c1", change: "AI-assisted", name: "Document with a structured template and an AI-drafted narrative", system: "EHR templates, Claude (under BAA)", touchMin: Math.max(12, F.docMin - 8),
          rationale: "Structured fields plus a narrative drafted from visit notes; the clinician reviews, edits, and signs every word.",
          questions: ["How will clinicians flag a wrong draft, and who reviews those flags each week?", "Which note types stay fully manual during the pilot?"] },
        { id: "f2", from: "c2", change: "Automated", name: "Pre-submit rules check, fix flags, sign the same day", system: "EHR rules engine", touchMin: 6, waitHrs: 8,
          rationale: "Missing fields and inconsistent codes are flagged at sign-off, so the clinician fixes them while the visit is fresh; same-day close is the SLA.",
          questions: ["Which rules block sign-off and which only warn?", "How do we keep the rule set current when plan requirements change?"] },
        { id: "f3", from: "c3", change: "Human-in-the-loop", name: "Risk-based QA: coders review flagged charts plus a 25% sample", system: "EHR QA worklist", waitHrs: 12, reworkPct: 0.02, pathPct: 0.45, volumePerMonth: F.r10(F.charts * 0.45),
          rationale: "Rules clear the routine checks, so coders spend their time on flagged charts and a random sample; the sample rate rises for clinicians with recent bounces.",
          questions: ["What sample rate keeps us inside plan audit requirements?", "When does a clinician move back to 100% review?"] },
        { id: "f4", from: "c4", change: "Unchanged", name: "Fix the bounced chart from an EHR task", system: "EHR task queue", waitHrs: 24, pathPct: 0.02, volumePerMonth: F.r10(F.charts * 0.02),
          rationale: "Still needed for the few issues the rules miss; the bounce arrives as an EHR task with the reason attached instead of an email." },
        { id: "f5", from: "c5", change: "Eliminated", rationale: "Corrections are re-checked by the same rules engine; coders spot-check instead of running a second full review." },
        { id: "f6", from: "c6", change: "Automated", name: "Nightly encounter batch from QA-passed charts", system: "EHR to clearinghouse integration", touchMin: 0.2, waitHrs: 18, reworkPct: 0.01, manual: false,
          rationale: "Charts that pass QA flow to the clearinghouse every night; billing reviews the exception report only.",
          questions: ["Does each plan accept daily batches, or do any require a weekly cadence?", "Who reviews the nightly exception report, and by what time?"] },
        { id: "f7", from: "c7", change: "Unchanged", reworkPct: 0.015, rationale: "The plan's turnaround stays the same; front-end edits are tested before submission, so fewer encounters bounce." },
        { id: "f8", from: "c8", change: "AI-assisted", name: "Work rejections from a queue sorted by reason with the likely fix", touchMin: 7, waitHrs: 24, pathPct: 0.015, volumePerMonth: F.r10(F.passed * 0.015),
          rationale: "Rejections arrive classified by reason with a suggested correction; the biller confirms and resubmits the same day.",
          questions: ["How often is the suggested fix wrong, and how do we track it?", "Which rejection types always go to a senior biller?"] },
      ],
    },
    {
      id: "roster-recon",
      code: "ROS",
      name: "Monthly health-plan roster reconciliation",
      short: "Roster reconciliation",
      dept: "Finance",
      owner: "Finance ops manager",
      ownerLane: "fin",
      unit: "roster",
      volUnit: "rosters",
      leadLabel: "roster posted to every system updated, per plan roster",
      kpi: "Reconciliation cycle time (days)",
      trigger: "A health plan posts its monthly eligibility roster",
      outcome: "CRM, scheduling, and dialer lists match the plan's eligible members",
      say: "Finance spends about four analyst days a month on a diff that a scheduled job can run, and the slow part is the three-day lag before Ops updates the CRM. Meanwhile termed members keep getting called, and any visit booked from those calls is not billable.",
      lanes: [
        { id: "plan", name: "Health plan", kind: "external", lead: "Plan eligibility team", dept: "Finance", headcount: 0 },
        { id: "fin", name: "Finance analyst", kind: "internal", lead: "Finance ops manager", dept: "Finance", headcount: 2 },
        { id: "ops", name: "Ops", kind: "internal", lead: "Operations manager", dept: "Operations", headcount: 3 },
        { id: "out", name: "Outreach", kind: "internal", lead: "Call center manager", dept: "Call center", headcount: F.agents - 4 },
      ],
      purpose: "Keep every internal system in step with each health plan's eligibility roster, so outreach only reaches eligible members and every completed visit is billable.",
      scope: {
        in: ["Monthly rosters and mid-month change files from all contracted plans", "Member status in CRM, scheduling system, and dialer lists", "Retroactive terms that affect billed visits"],
        out: ["Plan contract and capitation disputes", "Claims and encounter submission", "Member-facing communication about plan changes"],
      },
      phiStores: ["Access-controlled roster store", "Reconciliation review queue (role-based access)", "CRM member record", "Scheduling system"],
      phiShare: "a comment on the item in the reconciliation review queue",
      phi: [
        "Roster files stay in the access-controlled store; never download them to a laptop or personal drive.",
        "Share exceptions through the review queue. Do not attach member lists to email or post them in chat.",
        "Each reviewer sees only the columns needed to resolve an exception (minimum necessary).",
      ],
      exceptions: [
        { when: "A roster is more than 2 days late or fails layout validation", then: "Contact the plan's eligibility team and pause auto-suppression for that plan", owner: "Finance ops manager", within: "1 business day" },
        { when: "Match rate falls below 97% or term volume doubles month over month", then: "Stop auto-apply and send the run for a full human review", owner: "Finance analyst", within: "Same day", only: "future" },
        { when: "A deceased flag is found for a member with an upcoming visit", then: "Cancel the visit, suppress all outreach, and note the source", owner: "Ops", within: "Same day" },
        { when: "Completed visits are found for retro-termed members", then: "Flag for billing review and plan reconciliation", owner: "Billing manager", within: "Next billing cycle" },
      ],
      kpis: [
        { name: "Calls to ineligible members", today: "About 900 a month", target: "Under 100 a month", source: "Dialer dispositions, monthly" },
        { name: "Exception lists sent by email", today: "4 a month", target: "0", source: "Review queue audit log" },
        { name: "Visits completed for termed members", today: "Not tracked", target: "Tracked monthly; trending to 0", source: "Billing review, monthly" },
      ],
      current: [
        { id: "c1", lane: "plan", name: "Post the monthly eligibility roster to SFTP", system: "Plan SFTP (834 or CSV)", touchMin: 0, waitHrs: 0, volumePerMonth: 4, manual: false,
          rules: 0.9, judgment: 0.1,
          note: "Four plans, two formats (834 and CSV), posted on different days of the month.",
          questions: ["Which plans can send a daily change file instead of a monthly full roster?", "How does each plan tell us about retroactive terms?"] },
        { id: "c2", lane: "fin", name: "Download rosters from four SFTP sites", system: "SFTP client", touchMin: 20, waitHrs: 30, volumePerMonth: 4, manual: true,
          rules: 0.95, judgment: 0.05, fitWhy: "The same download from the same four sites every month.", phiGap: "Rosters are downloaded to the analyst's laptop.",
          note: "The analyst checks each site by hand, so a roster can sit a day or more before anyone notices it arrived.",
          questions: ["How do you know a new roster has posted?", "Where do downloaded files live, and who else can open that folder?"] },
        { id: "c3", lane: "fin", name: "Normalize layouts and VLOOKUP against the internal member file", system: "Excel", touchMin: 150, waitHrs: 24, reworkPct: 0.15, volumePerMonth: 4, manual: true,
          rules: 0.9, judgment: 0.15, fitWhy: "It is a repeatable diff between two lists with known match keys.",
          note: "Each roster has its own layout. Lookups break when IDs carry leading zeros or a column moves, and about 1 run in 7 is redone.",
          questions: ["Which match keys do you use, and what do you do when a member ID changed?", "How do you know the lookup did not silently drop rows?", "Which steps do you do in the same order every month?"] },
        { id: "c4", lane: "fin", name: "Research mismatches: termed, moved, deceased, ID changes", system: "Excel, plan portals", touchMin: 300, waitHrs: 8, volumePerMonth: 4, manual: true,
          rules: 0.6, judgment: 0.5,
          note: "About 150 exceptions per roster at roughly 2 minutes each, researched one at a time in plan portals.",
          questions: ["Which exception types can a rule resolve, and which need a person?", "How many exceptions repeat from last month because the fix never landed?"] },
        { id: "c5", lane: "fin", name: "Email exception lists to Ops and account managers", system: "Email with Excel attachments", touchMin: 30, waitHrs: 4, volumePerMonth: 4, manual: true, handoff: true,
          rules: 0.9, judgment: 0.1, phiGap: "Member-level exception lists travel as email attachments with no audit trail.",
          note: "Member-level exception lists go out as email attachments, which exposes PHI and leaves no record of who acted on what.",
          questions: ["Who receives the list, and does everyone need every column?", "How do you confirm Ops acted on each exception?"] },
        { id: "c6", lane: "ops", name: "Update member status in the CRM and the scheduling system", system: "CRM, scheduling system", touchMin: 400, waitHrs: 72, reworkPct: 0.1, volumePerMonth: 4, manual: true,
          rules: 0.8, judgment: 0.3,
          note: "Ops updates both systems by hand from the emailed list, usually three days after it arrives; about 1 update in 10 is missed or wrong.",
          questions: ["Which updates are you allowed to apply without a second check?", "What happens to a member's open appointment when they are termed?"] },
        { id: "c7", lane: "out", name: "Pull termed members from active call lists", system: "Dialer", touchMin: 90, waitHrs: 48, volumePerMonth: 4, manual: true,
          rules: 0.95, judgment: 0.05,
          note: "Call-list suppression waits for the next list rebuild, two days later on average.",
          questions: ["How often are call lists rebuilt, and who triggers it?", "Is there a do-not-call list the dialer checks automatically?"] },
        { id: "c8", lane: "out", name: "Calls to termed members before the lists refresh", system: "Dialer", touchMin: 3, waitHrs: 0, volumePerMonth: 900, volUnit: "calls", manual: true, handoff: false,
          rules: 0.5, judgment: 0.4, kpi: "Calls to ineligible members",
          note: "About 900 wasted calls a month reach members who are no longer eligible, and any visit booked from them is not billable.",
          questions: ["How many visits last quarter were completed for members already termed?", "What do agents say when a member tells them they changed plans?"] },
      ],
      future: [
        { id: "f1", from: "c1", change: "Unchanged", rationale: "Plans keep their current format; a daily change file is a follow-up ask at the next plan review." },
        { id: "f2", from: "c2", change: "Automated", name: "Scheduled SFTP pull as soon as the roster posts", system: "Scheduled job (n8n)", touchMin: 0, waitHrs: 1, manual: false,
          rationale: "A job polls each site hourly and pulls new rosters into an access-controlled store.",
          questions: ["Which alerts fire when a roster is late or empty?", "Where is the file stored, and who has access?"] },
        { id: "f3", from: "c3", change: "Automated", name: "Automated diff classifies every exception", system: "SQL, Python job", touchMin: 0, waitHrs: 1, reworkPct: 0.01, manual: false,
          rationale: "The job matches on member ID with fallbacks (name, date of birth, address) and labels each exception: termed, moved, deceased, or ID change.",
          questions: ["What match-rate threshold stops the job for a human check?", "How do we test the diff against last month's manual result before switching over?"] },
        { id: "f4", from: "c4", change: "Human-in-the-loop", name: "Analyst reviews only the ambiguous exceptions", system: "Review queue (role-based access)", touchMin: 75, waitHrs: 8,
          rationale: "Clear-cut terms apply automatically; the analyst reviews the roughly 25% that need judgment.",
          questions: ["What share of auto-applied changes do we audit each month?", "Who can override a classification, and is the override logged?"] },
        { id: "f5", from: "c5", change: "Eliminated", rationale: "Exceptions live in the shared review queue with access control, so no member data travels by email." },
        { id: "f6", from: "c6", change: "Human-in-the-loop", name: "Confirmed terms update the CRM automatically; Ops approves moves and deaths", system: "CRM and scheduling system APIs", touchMin: 120, waitHrs: 8, reworkPct: 0.02,
          rationale: "Terms post directly; moves and deceased flags wait for one Ops approval, and open appointments are cancelled with a note.",
          questions: ["Which change types need two approvals?", "How does a cancelled appointment get communicated to the member?"] },
        { id: "f7", from: "c7", change: "Automated", name: "Dialer suppression list syncs nightly", system: "Dialer API", touchMin: 0, waitHrs: 12, manual: false,
          rationale: "Termed members drop off call lists the night the roster lands.",
          questions: ["What happens if the nightly sync fails?", "How do we prove suppression worked the next morning?"] },
        { id: "f8", from: "c8", change: "Unchanged", name: "Calls to members termed retroactively", volumePerMonth: 90,
          note: "Retro terms dated before the roster arrives still produce a few calls.",
          rationale: "Retro terms dated before the roster arrives cannot be prevented; volume drops about 90% once suppression runs nightly." },
      ],
    },
    {
      id: "plan-onboarding",
      code: "ONB",
      name: "New health-plan onboarding",
      short: "Plan onboarding",
      dept: "Customer success",
      owner: "Customer success director",
      ownerLane: "cs",
      unit: "launch",
      volUnit: "launches",
      leadLabel: "contract signed to first completed visit",
      kpi: "Time to first visit (days)",
      trigger: "A new health-plan contract is signed",
      outcome: "The first members are reached and the first visit is completed",
      say: "Launches take about eleven weeks because every team waits on the one before it. Running clinical and ops setup alongside the data build is a sequencing change that costs nothing, and a standard questionnaire stops us re-asking the plan for requirements.",
      lanes: [
        { id: "cs", name: "Customer success", kind: "internal", lead: "Customer success director", dept: "Customer success", headcount: 3 },
        { id: "data", name: "Data & engineering", kind: "internal", lead: "Data engineering lead", dept: "Operations", headcount: 4 },
        { id: "ops", name: "Ops", kind: "internal", lead: "Operations manager", dept: "Operations", headcount: 3 },
        { id: "clinical", name: "Clinical", kind: "internal", lead: "Clinical director", dept: "Clinical", headcount: 2 },
        { id: "plan", name: "Health plan", kind: "external", lead: "Plan program manager", dept: "Customer success", headcount: 0 },
      ],
      purpose: "Launch each new health plan predictably: clear requirements, a validated data feed, trained teams, and a first completed visit on a committed date.",
      scope: {
        in: ["New plan contracts and new lines of business with an existing plan", "Requirements, data feed, clinical template, outreach setup, and go-live readiness", "First 30 days of hypercare after go-live"],
        out: ["Contract negotiation and pricing", "Ongoing plan reporting after hypercare", "Credentialing with the plan's network"],
      },
      phiStores: ["Access-controlled SFTP and roster store", "EHR", "CRM", "Project tracker (no member-level data)"],
      phiShare: "a link to the file in the access-controlled store (never the data itself in the tracker)",
      phi: [
        "Test files contain real member data: they stay in the access-controlled store and are never attached to email or tickets.",
        "Use de-identified samples for training and demos.",
        "Confirm the BAA and data-sharing terms are signed before the first file is received.",
      ],
      exceptions: [
        { when: "Test file fails validation twice", then: "Hold a joint data call with the plan within 2 business days and reset the launch date if needed", owner: "Data engineering lead", within: "2 business days" },
        { when: "A launch task is more than 5 days late", then: "Escalate to the launch sponsor in the weekly launch review", owner: "Customer success director", within: "Next weekly review" },
        { when: "BAA or data-sharing agreement is not signed", then: "No member data is received or loaded; go-live date is at risk", owner: "Customer success director", within: "Before any file transfer" },
      ],
      kpis: [
        { name: "Test-file rounds per launch", today: "2 or more on half of launches", target: "1", source: "Launch tracker" },
        { name: "Launches slipping at readiness review", today: "About 1 in 3", target: "1 in 10 or fewer", source: "Launch tracker, monthly" },
        { name: "Requirements re-asked after kickoff", today: "About 25%", target: "Under 10%", source: "Kickoff questionnaire log" },
      ],
      current: [
        { id: "c1", lane: "plan", name: "Sign the contract and share program requirements", system: "Contract, email", touchMin: 0, waitHrs: 0, volumePerMonth: 1, manual: false,
          rules: 0.4, judgment: 0.6,
          note: "Requirements arrive as a contract exhibit plus email threads with the plan's quality team.",
          questions: ["Which requirements change our workflow: visit types, measures, reporting cadence?", "Who on the plan side signs off on go-live?"] },
        { id: "c2", lane: "cs", name: "Kickoff and requirements gathering over email", system: "Email, slide deck", touchMin: 600, waitHrs: 120, reworkPct: 0.25, volumePerMonth: 1, manual: true,
          rules: 0.5, judgment: 0.6, text: true,
          note: "No standard questionnaire, so about a quarter of requirements are re-asked later.",
          questions: ["Which questions do you end up asking every plan?", "Where do decisions from the kickoff get written down?", "What went wrong on the last launch that we only found in week 8?"] },
        { id: "c3", lane: "plan", name: "Send the eligibility file spec and a test file", system: "SFTP", touchMin: 0, waitHrs: 240, volumePerMonth: 1, manual: false,
          rules: 0.5, judgment: 0.3,
          note: "The test file usually arrives about 10 days after kickoff because nobody asked for it with a date.",
          questions: ["Can we request the spec and a test file at contract signature?", "Who at the plan owns their file extract?"] },
        { id: "c4", lane: "data", name: "Build file intake and mapping for the new layout", system: "SQL, SFTP", touchMin: 2400, waitHrs: 336, reworkPct: 0.3, volumePerMonth: 1, manual: true,
          rules: 0.7, judgment: 0.4,
          note: "Each plan gets a custom build, and the work waits about two weeks in the engineering queue.",
          questions: ["What share of the mapping is the same as the last plan?", "How is this request prioritized against product work?", "Which fields cause the most rework?"] },
        { id: "c5", lane: "data", name: "Validate the test file; defects found late", system: "SQL, Excel", touchMin: 480, waitHrs: 72, reworkPct: 0.5, volumePerMonth: 1, manual: true, decision: true, handoff: false,
          rules: 0.85, judgment: 0.2,
          note: "Half of launches need another test file because defects surface during validation instead of at intake.",
          questions: ["Which checks do you run every time?", "How many test-file rounds did the last three launches take?"] },
        { id: "c6", lane: "clinical", name: "Build the assessment template and care-gap protocol", system: "EHR", touchMin: 1200, waitHrs: 240, reworkPct: 0.2, volumePerMonth: 1, manual: true,
          rules: 0.4, judgment: 0.7,
          note: "Starts only after data validation finishes, even though it does not depend on it.",
          questions: ["How much of the template is reused from existing plans?", "Who approves the clinical protocol on each side?"] },
        { id: "c7", lane: "ops", name: "Set up outreach scripts, call lists, staffing, and training", system: "Dialer, CRM, LMS", touchMin: 1440, waitHrs: 168, reworkPct: 0.15, volumePerMonth: 1, manual: true,
          rules: 0.5, judgment: 0.6,
          note: "Staffing is sized from the contract's member count instead of a forecast of reachable members.",
          questions: ["How do you size staffing for a new plan today?", "What training does an agent need before calling a new plan's members?"] },
        { id: "c8", lane: "cs", name: "Go-live readiness review from a tracker spreadsheet", system: "Spreadsheet, email", touchMin: 240, waitHrs: 72, reworkPct: 0.3, volumePerMonth: 1, manual: true, decision: true,
          rules: 0.6, judgment: 0.5,
          note: "Tasks live in email and one person's head; about 1 launch in 3 slips a week at the readiness review.",
          questions: ["Which item most often blocks go-live?", "Who can see launch status without asking you?"] },
        { id: "c9", lane: "clinical", name: "First completed visit for the plan's members", system: "Scheduling system, EHR", touchMin: 60, waitHrs: 240, volumePerMonth: 1, manual: true,
          rules: 0.3, judgment: 0.6,
          note: "First visits land about 10 days after the first calls because launch-week slots were not reserved.",
          questions: ["Can we pre-block clinician slots for launch week?", "Which market will serve the first members?"] },
      ],
      future: [
        { id: "f1", from: "c1", change: "Unchanged", rationale: "The contract stays the same; the spec and test-file request now goes out at signature." },
        { id: "f2", from: "c2", change: "AI-assisted", name: "Templated kickoff: standard questionnaire and a drafted launch plan", system: "Questionnaire form, project tracker, Claude", touchMin: 360, waitHrs: 72, reworkPct: 0.1,
          rationale: "Every plan answers the same questionnaire; Claude drafts the launch plan with owners and dates from it, and CS reviews it with the plan.",
          questions: ["Which questionnaire answers must be complete before the launch plan is drafted?", "Who reviews the drafted plan before it goes to the health plan?"] },
        { id: "f3", from: "c3", change: "Unchanged", name: "Send the file spec and a test file by a dated checklist item", waitHrs: 120,
          rationale: "Same task for the plan, requested at signature with a due date, so it arrives in about 5 days instead of 10." },
        { id: "f4", from: "c4", change: "AI-assisted", name: "Configure intake from a reusable mapping template", system: "Canonical schema, SQL", touchMin: 1200, waitHrs: 240, reworkPct: 0.15,
          rationale: "New layouts map onto one canonical schema; suggested field mappings are confirmed by an engineer, and launches get a reserved slot in the queue.",
          questions: ["What share of fields map correctly on the first try?", "Who signs off that the mapping is correct?"] },
        { id: "f6", from: "c6", change: "Unchanged", parallel: true, name: "Configure the template from the standard assessment library", touchMin: 600, waitHrs: 120, reworkPct: 0.1,
          rationale: "Same clinical work, started alongside the data build and drawn from the standard assessment library." },
        { id: "f7", from: "c7", change: "Unchanged", parallel: true, name: "Set up scripts, lists, and staffing from a reachable-member forecast", touchMin: 960, waitHrs: 120, reworkPct: 0.1,
          rationale: "Same work, run alongside the data build; staffing uses the contact-rate and schedule-rate forecast." },
        { id: "f5", from: "c5", change: "Automated", name: "Automated test-file validation report", system: "Validation job", touchMin: 60, waitHrs: 8, reworkPct: 0.15, manual: false,
          rationale: "The same checks run in minutes on every test file and produce a defect report the plan can act on.",
          questions: ["Which defects go straight back to the plan?", "What pass threshold allows go-live?"] },
        { id: "f8", from: "c8", change: "Human-in-the-loop", name: "Go-live gate from a shared launch tracker with automated reminders", system: "Project tracker, Zapier", touchMin: 90, waitHrs: 24, reworkPct: 0.1,
          rationale: "Owners get automated reminders, status is visible to everyone, and CS runs a single go or no-go review.",
          questions: ["Which three items are hard gates for go-live?", "Who can see launch status without asking CS?"] },
        { id: "f9", from: "c9", change: "Unchanged", rationale: "Calendar lead time for the first visit stays; pre-blocking launch-week slots is the next ask of Provider ops." },
      ],
    },
  ];

  // ---------- normalize: defaults, handoffs, and future-state inheritance ----------
  const BASE = { touchMin: 0, waitHrs: 0, reworkPct: 0, volumePerMonth: 0, manual: false, decision: false, pathPct: 1, parallel: false, rules: 0.5, judgment: 0.5, note: "", questions: [] };
  const NO_INHERIT = { id: 1, from: 1, change: 1, rationale: 1, handoff: 1, phiGap: 1, note: 1, parallel: 1 };
  PROCESSES.forEach((proc) => {
    const byId = {};
    proc.current = proc.current.map((s, i, arr) => {
      const o = Object.assign({}, BASE, s);
      if (s.handoff === undefined) o.handoff = i > 0 && arr[i - 1].lane !== s.lane;
      byId[o.id] = o;
      return o;
    });
    let prevLane = null;
    proc.future = proc.future.map((s) => {
      const src = s.from ? byId[s.from] : null;
      const inh = {};
      if (src) Object.keys(src).forEach((k) => { if (!NO_INHERIT[k]) inh[k] = src[k]; });
      const o = Object.assign({}, BASE, inh, s);
      o.change = s.change || "Unchanged";
      o.questions = (s.questions || (src && src.questions) || []).slice();
      if (s.note === undefined) o.note = src && o.change === "Unchanged" ? src.note : "";
      if (s.handoff === undefined) o.handoff = o.change !== "Eliminated" && prevLane != null && prevLane !== o.lane && !o.parallel;
      if (o.change !== "Eliminated" && !o.parallel) prevLane = o.lane;
      return o;
    });
  });
  const BY_ID = {};
  PROCESSES.forEach((p) => (BY_ID[p.id] = p));
  OPS.processes = PROCESSES;

  // ---------- edited steps (per viewer; memory first so edits work without storage) ----------
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const memEdits = {};
  const editKey = (pid, ver) => "wf.v1.edits." + pid + "." + ver;
  function getSteps(pid, ver) {
    const k = editKey(pid, ver);
    if (memEdits[k]) return memEdits[k];
    const stored = UI.store.get(k, null);
    if (Array.isArray(stored) && stored.length) { memEdits[k] = stored; return stored; }
    const p = BY_ID[pid];
    return p ? clone(p[ver === "future" ? "future" : "current"]) : [];
  }
  function saveSteps(pid, ver, steps) { const k = editKey(pid, ver); memEdits[k] = steps; UI.store.set(k, steps); }
  function resetSteps(pid, ver) { const k = editKey(pid, ver); delete memEdits[k]; UI.store.remove(k); }
  function isEdited(pid, ver) { const k = editKey(pid, ver); return !!memEdits[k] || Array.isArray(UI.store.get(k, null)); }

  // ---------- flow metrics ----------
  const isActive = (s) => s.change !== "Eliminated";
  function laneOf(proc, id) { return proc.lanes.find((l) => l.id === id) || proc.lanes[0]; }
  function metrics(proc, steps) {
    const per = {};
    const act = steps.filter(isActive);
    act.forEach((s) => {
      const path = s.pathPct == null ? 1 : +s.pathPct;
      const rw = +s.reworkPct || 0;
      const k = path * (1 + rw);
      const ext = laneOf(proc, s.lane).kind === "external";
      // batch steps (one file for thousands of members) are elapsed waiting time from the member's view
      const work = (k * (+s.touchMin || 0)) / 60;
      const wait = k * (+s.waitHrs || 0) + (s.batch ? work : 0);
      const touch = s.batch ? 0 : work;
      const labor = ext ? 0 : ((+s.touchMin || 0) * (+s.volumePerMonth || 0) * (1 + rw)) / 60;
      const rework = ext ? 0 : ((+s.touchMin || 0) * (+s.volumePerMonth || 0) * rw) / 60;
      per[s.id] = { wait, touch, contrib: wait + touch, labor, rework, ext, critical: false, share: 0, laborShare: 0 };
    });
    const groups = [];
    act.forEach((s) => { if (s.parallel && groups.length) groups[groups.length - 1].push(s); else groups.push([s]); });
    let lead = 0, touch = 0;
    groups.forEach((g) => {
      let best = g[0];
      g.forEach((s) => { if (per[s.id].contrib > per[best.id].contrib) best = s; });
      per[best.id].critical = true;
      lead += per[best.id].contrib;
      touch += per[best.id].touch;
    });
    let labor = 0, rework = 0, bottleneck = null, hot = null;
    const laborByLane = {};
    proc.lanes.forEach((l) => (laborByLane[l.id] = 0));
    act.forEach((s) => {
      const p = per[s.id];
      labor += p.labor;
      rework += p.rework;
      laborByLane[s.lane] = (laborByLane[s.lane] || 0) + p.labor;
      if (p.critical && p.contrib > 0 && (!bottleneck || p.contrib > per[bottleneck].contrib)) bottleneck = s.id;
      if (p.labor > 0 && (!hot || p.labor > per[hot].labor)) hot = s.id;
    });
    act.forEach((s) => {
      const p = per[s.id];
      p.share = lead && p.critical ? p.contrib / lead : 0;
      p.laborShare = labor ? p.labor / labor : 0;
    });
    return {
      lead, touch, wait: Math.max(0, lead - touch), pce: lead ? Math.min(1, touch / lead) : 0,
      handoffs: act.filter((s) => s.handoff).length,
      manual: act.filter((s) => s.manual).length,
      steps: act.length, labor, rework, fte: labor / 160, per, bottleneck, hot, laborByLane,
    };
  }

  // ---------- formatting ----------
  const trimNum = (v, d) => { const s = Number(v || 0).toFixed(d); return s.indexOf(".") >= 0 ? s.replace(/\.?0+$/, "") : s; };
  function fmtMin(m) {
    m = +m || 0;
    if (!m) return "0 min";
    if (m < 1) return Math.round(m * 60) + " sec";
    if (m >= 120) return trimNum(m / 60, 1) + " hrs";
    return trimNum(m, 1) + " min";
  }
  function fmtWait(h, long) {
    h = +h || 0;
    if (!h) return "No wait";
    if (h < 1) return Math.round(h * 60) + " min";
    if (h < 48) return trimNum(h, 1) + (long ? (trimNum(h, 1) === "1" ? " hour" : " hours") : " h");
    return trimNum(h / 24, 1) + (long ? (trimNum(h / 24, 1) === "1" ? " day" : " days") : " d");
  }
  function fmtLead(h) {
    h = +h || 0;
    if (h < 1) return Math.round(h * 60) + " min";
    if (h < 48) return trimNum(h, 1) + " hrs";
    const d = h / 24;
    if (d < 42) return trimNum(d, 1) + " days";
    return trimNum(d / 7, 1) + " weeks";
  }
  const volUnit = (proc, s) => s.volUnit || proc.volUnit;
  const fmtPce = (v) => UI.fmt.pct(v, v < 0.001 ? 2 : v < 0.1 ? 1 : 0);
  const trunc = (t, n) => (t.length > n ? t.slice(0, n - 1).replace(/[\s,:;]+$/, "") + "…" : t);

  OPS.workflow = {
    get: (id) => BY_ID[id] || null,
    steps: (id, ver) => clone(getSteps(id, ver)),
    isEdited,
    metrics,
    isActive,
    laneOf,
    fmt: { min: fmtMin, wait: fmtWait, lead: fmtLead },
    facts: F,
  };

  // ---------- automation fit ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function fitScore(s, p) {
    if (!isActive(s) || !p) return null;
    if (p.ext) return { na: true };
    const manual = s.manual ? 1 : 0.2;
    const cnt = clamp(Math.log10(Math.max(1, +s.volumePerMonth || 0)) / Math.log10(20000), 0.05, 1);
    const hrs = clamp(Math.log10(1 + p.labor) / Math.log10(601), 0.05, 1);
    const volume = (cnt + hrs) / 2;
    const rules = clamp(s.rules == null ? 0.5 : +s.rules, 0.05, 1);
    const judg = clamp(s.judgment == null ? 0.5 : +s.judgment, 0, 0.95);
    const lowJ = 1 - judg;
    const score = Math.round(100 * Math.pow(manual * volume * rules * lowJ, 0.25));
    let aKey, approach;
    if (!s.manual) { aKey = "tune"; approach = "Already system-driven. Tune the rules and monitor the exceptions."; }
    else if (rules >= 0.7 && judg <= 0.35) { aKey = "auto"; approach = "Automate with rules or an integration; people work the exceptions only."; }
    else if (judg >= 0.75) { aKey = "human"; approach = "Keep it human-led. Give people better data, templates, and fewer interruptions."; }
    else if (s.text) { aKey = "ai"; approach = "AI-assisted: a model drafts, the person confirms, and low-confidence cases go to review."; }
    else { aKey = "flow"; approach = "Streamline with workflow tooling: a shared queue, clear SLAs, and automated reminders."; }
    const band = score >= 75 ? { level: "good", text: "Strong fit" } : score >= 55 ? { level: "warning", text: "Moderate fit" } : { level: "neutral", text: "Weak fit" };
    const parts = [
      s.manual ? "Manual today" : "Already system-driven",
      UI.fmt.num(s.volumePerMonth) + " a month (" + UI.fmt.num(p.labor) + " hrs of work)",
      rules >= 0.7 ? "follows clear rules" : rules >= 0.4 ? "partly rule-based" : "depends on the situation",
      judg <= 0.3 ? "needs little judgment" : judg <= 0.6 ? "needs some judgment" : "needs heavy judgment (clinical or relationship)",
    ];
    return { score, band, aKey, approach, manual, volume, rules, lowJ, why: parts.join(", ") + "." + (s.fitWhy ? " " + s.fitWhy : "") };
  }

  // ---------- module state ----------
  let st = null;
  let els = {};
  let charts = {};
  let ro = null;
  let resetTimer = null;
  const VIEWS = [{ value: "current", label: "Current state" }, { value: "future", label: "Future state" }, { value: "compare", label: "Compare" }];
  const CHANGE_TYPES = ["Automated", "AI-assisted", "Human-in-the-loop", "Eliminated", "Unchanged"];
  const CHANGE_CLS = { Automated: "auto", "AI-assisted": "ai", "Human-in-the-loop": "hitl", Eliminated: "elim", Unchanged: "same" };

  const P = () => BY_ID[st.pid];
  const shownVer = () => (st.view === "current" ? "current" : "future");
  const editVer = () => (st.view === "compare" ? st.editTarget : st.view);

  function cleanup() {
    if (ro) { try { ro.disconnect(); } catch (e) { /* ignore */ } ro = null; }
    clearTimeout(resetTimer);
    charts = {};
  }

  function upsertChart(key, id, config) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const c = charts[key];
    if (c && c.canvas === canvas) {
      c.data.labels = config.data.labels;
      config.data.datasets.forEach((ds, i) => { if (c.data.datasets[i]) Object.assign(c.data.datasets[i], ds); else c.data.datasets.push(ds); });
      c.data.datasets.length = config.data.datasets.length;
      if (config.options && config.options.scales) c.options.scales = Object.assign(c.options.scales || {}, config.options.scales);
      c.update("none");
      return;
    }
    charts[key] = UI.chart(canvas, config);
  }

  // ---------- CSS ----------
  UI.style("workflow", `
    .wf-controls { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: flex-end; }
    .wf-controls > .field { flex: 1 1 280px; max-width: 440px; }
    .wf-viewfield { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .wf-viewfield > span { font-size: var(--fs-sm); color: var(--ink-2); font-weight: 500; }
    .wf-edit-btn[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent-line); color: var(--ink); }
    .wf-meta { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: var(--fs-sm); color: var(--ink-2); }
    .wf-meta b { color: var(--ink); font-weight: 600; }
    .wf-meta .wf-arrow-txt { color: var(--ink-3); }
    .wf-scroll { overflow-x: auto; overflow-y: hidden; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); min-width: 0; overscroll-behavior-x: contain; }
    .wf-swim { --wf-lane-w: 118px; --wf-col-w: 158px; --wf-row-h: 118px; position: relative; display: grid; width: max-content; min-width: 100%; column-gap: 34px; padding-right: 24px; }
    .wf-band { grid-column: 1 / -1; border-bottom: 1px solid var(--line); }
    .wf-band.alt { background: var(--surface-2); }
    .wf-lane { position: sticky; left: 0; z-index: 3; display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 10px 12px; background: var(--surface); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); min-width: 0; }
    .wf-lane.alt { background: var(--surface-2); }
    .wf-lane b { font-size: var(--fs-sm); font-weight: 600; color: var(--ink); line-height: 1.25; }
    .wf-lane small { font-family: var(--font-mono); font-size: 0.625rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
    .wf-cell { display: flex; flex-direction: column; justify-content: center; gap: 8px; padding: 12px 0; min-width: 0; position: relative; z-index: 1; }
    .wf-svg { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 0; overflow: visible; }
    .wf-edge { fill: none; stroke: var(--ink-3); stroke-width: 1.5; opacity: 0.75; }
    .wf-edge.dash { stroke-dasharray: 4 4; opacity: 0.5; }
    .wf-arrowhead { fill: var(--ink-3); opacity: 0.85; }
    .wf-hand { fill: var(--accent); stroke: var(--surface); stroke-width: 2; }
    .wf-card { position: relative; z-index: 1; width: 100%; text-align: left; font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line-strong); border-left: 4px solid var(--line-strong); border-radius: var(--r-md); padding: 7px 9px 8px; display: flex; flex-direction: column; gap: 4px; cursor: pointer; box-shadow: var(--shadow); min-width: 0; }
    .wf-card:hover { border-color: var(--accent-line); }
    .wf-card.is-wait { border-left-color: var(--warning); }
    .wf-card.is-hot { border-left-color: var(--serious); }
    .wf-card.is-bneck { border-left-color: var(--critical); border-left-width: 6px; }
    .wf-card.is-sel { outline: 2px solid var(--accent); outline-offset: 2px; }
    .wf-card.is-ext { box-shadow: none; border-style: dashed; border-left-style: solid; }
    .wf-card.is-ghost { background: transparent; border-style: dashed; border-left: 1px dashed var(--line-strong); box-shadow: none; color: var(--ink-3); }
    .wf-card.is-ghost .wf-name { text-decoration: line-through; color: var(--ink-3); }
    .wf-flag { font-size: 0.6875rem; font-weight: 700; border-radius: 4px; padding: 1px 6px; align-self: flex-start; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
    .wf-flag.crit { background: var(--critical-soft); color: var(--critical-ink); }
    .wf-flag.ser { background: var(--serious-soft); color: var(--serious-ink); }
    .wf-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .wf-num { font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 600; color: var(--ink-3); }
    .wf-wait { font-family: var(--font-mono); font-size: 0.6875rem; border-radius: 999px; padding: 0 7px; background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--line); white-space: nowrap; }
    .wf-wait.long { background: var(--warning-soft); color: var(--warning-ink); border-color: transparent; }
    .wf-wait.long::before { content: "▲ "; font-size: 0.8em; }
    .wf-name { font-size: 0.8125rem; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .wf-sys { font-size: 0.6875rem; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wf-stats { display: flex; flex-wrap: wrap; gap: 2px 8px; font-size: 0.6875rem; color: var(--ink-2); font-variant-numeric: tabular-nums; }
    .wf-stats .wf-branch { color: var(--ink-3); }
    .wf-chg { display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; font-size: 0.6875rem; font-weight: 600; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
    .wf-chg::before { font-size: 0.8em; }
    .wf-chg.auto { background: var(--good-soft); color: var(--good-ink); }
    .wf-chg.auto::before { content: "●"; }
    .wf-chg.ai { background: var(--accent-soft); color: var(--accent); }
    .wf-chg.ai::before { content: "◇"; }
    .wf-chg.hitl { background: var(--warning-soft); color: var(--warning-ink); }
    .wf-chg.hitl::before { content: "◐"; }
    .wf-chg.elim { background: var(--critical-soft); color: var(--critical-ink); }
    .wf-chg.elim::before { content: "✕"; }
    .wf-chg.same { background: var(--surface-2); color: var(--ink-3); }
    .wf-chg.same::before { content: "○"; }
    .wf-legend i.crit { background: var(--critical); }
    .wf-legend i.ser { background: var(--serious); }
    .wf-legend i.warn { background: var(--warning); }
    .wf-legend i.hand { background: var(--accent); transform: rotate(45deg) scale(0.8); border-radius: 1px; }
    .wf-insight { align-items: center; }
    .wf-insight .wf-ins-body { display: flex; flex-wrap: wrap; gap: 6px 18px; min-width: 0; }
    .wf-insight .wf-ins-body > span { min-width: 0; }
    .wf-ladder-wrap { display: flex; flex-direction: column; gap: 6px; }
    .wf-ladder { display: flex; gap: 2px; height: 28px; border-radius: 6px; overflow: hidden; background: var(--surface); }
    .wf-seg { flex-basis: 0; min-width: 4px; border: 0; margin: 0; padding: 0 4px; height: 100%; font: inherit; font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 600; color: var(--ink); background: var(--seq-2); cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: clip; }
    .wf-seg.alt { background: var(--seq-3); }
    .wf-seg.is-b { background: var(--critical-soft); color: var(--critical-ink); box-shadow: inset 0 0 0 2px var(--critical); }
    .wf-seg.is-sel { box-shadow: inset 0 0 0 2px var(--accent); }
    .wf-ladder-foot { display: flex; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; font-size: var(--fs-xs); color: var(--ink-3); }
    .wf-ladder-foot b { color: var(--ink-2); font-weight: 600; }
    .wf-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin: 0; }
    .wf-facts > div { background: var(--surface-2); border-radius: var(--r-md); padding: 8px 10px; min-width: 0; }
    .wf-facts dt { font-size: var(--fs-xs); color: var(--ink-3); }
    .wf-facts dd { margin: 2px 0 0; font-weight: 600; font-variant-numeric: tabular-nums; font-size: var(--fs-sm); }
    .wf-facts dd s { color: var(--ink-3); font-weight: 500; margin-right: 4px; }
    .wf-qs { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: var(--fs-sm); }
    .wf-fit { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px 18px; align-items: start; }
    .wf-fit-score { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    .wf-fit-num { font-family: var(--font-display); font-size: 2.25rem; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
    .wf-fit-num small { font-size: 0.45em; color: var(--ink-3); font-weight: 500; }
    .wf-factors { display: grid; grid-template-columns: minmax(84px, auto) minmax(60px, 1fr) 3ch; gap: 6px 10px; align-items: center; font-size: var(--fs-xs); color: var(--ink-2); }
    .wf-factors .bar { height: 6px; }
    .wf-factors span.num { text-align: right; color: var(--ink); font-weight: 600; }
    .wf-actions { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
    .wf-status { font-size: var(--fs-sm); color: var(--ink-2); }
    .wf-detail-head { display: flex; flex-direction: column; gap: 6px; }
    .wf-detail-head .row { gap: 6px; }
    .wf-edit-table td { vertical-align: middle; padding: 6px 8px; }
    .wf-edit-table .input, .wf-edit-table .select { padding: 5px 7px; font-size: var(--fs-xs); }
    .wf-in-name { min-width: 15em; }
    .wf-in-num { width: 5.8em; text-align: right; font-variant-numeric: tabular-nums; }
    .wf-edit-table select { min-width: 8.5em; }
    .wf-edit-table tr.is-sel td { background: var(--accent-soft); }
    .wf-edit-table tr.is-elim td { opacity: 0.6; }
    .wf-edit-head-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .btn.wf-danger { border-color: var(--critical); color: var(--critical-ink); background: var(--critical-soft); }
    .wf-change-list td:nth-child(2) { min-width: 13em; }
    .wf-change-list td:nth-child(4) { min-width: 18em; }
    .wf-mix { display: flex; flex-wrap: wrap; gap: 6px; }
    .toast .wf-toast-link { color: inherit; font-weight: 700; text-decoration: underline; margin-left: 6px; }
    @media (max-width: 560px) {
      .wf-swim { --wf-lane-w: 86px; --wf-col-w: 142px; --wf-row-h: 108px; column-gap: 26px; }
      .wf-lane { padding: 8px; }
      .wf-lane b { font-size: var(--fs-xs); }
      .wf-fit { grid-template-columns: minmax(0, 1fr); }
      .wf-in-name { min-width: 11em; }
    }
  `);

  // ---------- render ----------
  function render(root, ctx) {
    cleanup();
    const saved = UI.store.get("wf.ui", {}) || {};
    const prm = ctx.params || {};
    const prev = st;
    st = {
      pid: BY_ID[prm.process] ? prm.process : prev ? prev.pid : BY_ID[saved.pid] ? saved.pid : "scheduling",
      view: VIEWS.some((v) => v.value === prm.view) ? prm.view : prev ? prev.view : VIEWS.some((v) => v.value === saved.view) ? saved.view : "current",
      sel: prm.step || (prev && !prm.process ? prev.sel : null),
      edit: prev ? prev.edit : false,
      editTarget: prev ? prev.editTarget : "current",
      confirmReset: false,
    };

    root.innerHTML = `
      <div class="panel wf-toolbar">
        <div class="wf-controls">
          ${UI.select("wf-proc", PROCESSES.map((p) => ({ value: p.id, label: p.name })), st.pid, "Process")}
          <div class="wf-viewfield"><span id="wf-view-label">View</span>${UI.seg("wf-view", VIEWS, st.view)}</div>
          <button type="button" class="btn wf-edit-btn" id="wf-edit-btn" aria-pressed="${st.edit}" aria-controls="wf-edit">${UI.icon("doc")}<span>Edit numbers</span></button>
        </div>
        <div class="wf-meta" id="wf-meta"></div>
      </div>
      <div class="presenter-note">This is how I run discovery: sit with the people doing the work, then map every handoff with real timings. Volumes here come from the same operating data as the dashboard, so the map and the metrics agree; the timings are what I would confirm in week one.</div>
      <div class="grid g-4" id="wf-kpis"></div>
      <div id="wf-compare" class="stack" style="gap:16px"></div>
      <div class="panel" id="wf-map-panel">
        <div class="panel-head">
          <div><h2 id="wf-map-title">Current state</h2><p class="panel-sub" id="wf-map-sub"></p></div>
          <div class="legend wf-legend" aria-label="Map legend">
            <span><i class="crit"></i>Bottleneck (largest share of lead time)</span>
            <span><i class="ser"></i>Most labor hours</span>
            <span><i class="warn"></i>Wait of a day or more</span>
            <span><i class="hand"></i>Handoff</span>
          </div>
        </div>
        <div id="wf-callout"></div>
        <div class="wf-scroll" id="wf-scroll" tabindex="0" role="region" aria-label="Swimlane map, scrolls sideways"><div class="wf-swim" id="wf-swim"></div></div>
        <div id="wf-ladder"></div>
        <div class="presenter-note" id="wf-say"></div>
      </div>
      <div id="wf-edit"></div>
      <div class="grid g-2">
        <div class="panel" id="wf-detail" aria-live="polite"></div>
        <div class="panel" id="wf-hours">
          <div class="panel-head"><div><h3>Where the labor hours go</h3><p class="panel-sub" id="wf-hours-sub">Hands-on and rework hours per month by step, internal teams only</p></div></div>
          <div class="chart-box" id="wf-hours-box"><canvas id="wf-hours-c" aria-label="Labor hours per month by step"></canvas></div>
          <div class="presenter-note">Each step carries the discovery questions I would ask the person doing it, plus an automation-fit score. One click sends it to the pipeline with the hours already estimated, so prioritization starts from evidence.</div>
        </div>
      </div>`;

    els = {
      root,
      meta: root.querySelector("#wf-meta"),
      kpis: root.querySelector("#wf-kpis"),
      compare: root.querySelector("#wf-compare"),
      mapTitle: root.querySelector("#wf-map-title"),
      mapSub: root.querySelector("#wf-map-sub"),
      callout: root.querySelector("#wf-callout"),
      scroll: root.querySelector("#wf-scroll"),
      swim: root.querySelector("#wf-swim"),
      ladder: root.querySelector("#wf-ladder"),
      say: root.querySelector("#wf-say"),
      edit: root.querySelector("#wf-edit"),
      detail: root.querySelector("#wf-detail"),
      hoursBox: root.querySelector("#wf-hours-box"),
      hoursSub: root.querySelector("#wf-hours-sub"),
      editBtn: root.querySelector("#wf-edit-btn"),
    };
    const seg = root.querySelector("#wf-view");
    if (seg) seg.setAttribute("aria-labelledby", "wf-view-label");

    root.querySelector("#wf-proc").addEventListener("change", (e) => {
      st.pid = e.target.value;
      st.sel = null;
      st.confirmReset = false;
      persistUi();
      refreshAll(true);
    });
    UI.wireSeg(root, "wf-view", (v) => {
      const fromVer = shownVer();
      st.view = v;
      st.sel = mapSel(st.sel, fromVer, shownVer());
      st.confirmReset = false;
      persistUi();
      refreshAll(true);
    });
    els.editBtn.addEventListener("click", () => {
      st.edit = !st.edit;
      els.editBtn.setAttribute("aria-pressed", String(st.edit));
      renderEdit();
      if (st.edit) els.edit.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    // map + ladder selection (the ladder doubles as a minimap: it scrolls the card into view)
    UI.on(root, "click", "[data-pick]", (e, el) => {
      const fromCard = el.classList.contains("wf-card");
      selectStep(el.dataset.pick, fromCard);
      if (!fromCard) revealCard(el.dataset.pick);
    });
    // detail actions
    UI.on(els.detail, "click", "[data-act='send']", (e, el) => sendToPipeline(el.dataset.step));
    UI.on(els.detail, "click", "[data-act='open-pipe']", (e, el) => { e.preventDefault(); OPS.navigate("pipeline", { opp: el.dataset.opp }); });
    // compare table row → select step
    UI.on(els.compare, "click", "[data-row-step]", (e, el) => {
      if (e.target.closest("a,button")) return;
      selectStep(el.dataset.rowStep, false);
      revealCard(el.dataset.rowStep);
      els.scroll.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    wireEdit();

    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => requestAnimationFrame(drawEdges));
      ro.observe(els.swim);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestAnimationFrame(drawEdges)).catch(() => {});

    refreshAll(true);
  }

  function persistUi() { UI.store.set("wf.ui", { pid: st.pid, view: st.view }); }

  function mapSel(sel, fromVer, toVer) {
    if (!sel || fromVer === toVer) return sel;
    const from = getSteps(st.pid, fromVer).find((s) => s.id === sel);
    if (!from) return null;
    const to = getSteps(st.pid, toVer);
    const hit = toVer === "future" ? to.find((s) => s.from === from.id) : to.find((s) => s.id === from.from);
    return hit ? hit.id : null;
  }

  function selectStep(id, scrollDetail) {
    st.sel = id;
    els.swim.querySelectorAll(".wf-card").forEach((c) => {
      const on = c.dataset.pick === id;
      c.classList.toggle("is-sel", on);
      c.setAttribute("aria-pressed", String(on));
    });
    els.ladder.querySelectorAll(".wf-seg").forEach((c) => c.classList.toggle("is-sel", c.dataset.pick === id));
    if (els.edit) els.edit.querySelectorAll("tr[data-sid]").forEach((r) => r.classList.toggle("is-sel", r.dataset.sid === id));
    renderDetail();
    if (scrollDetail && window.innerWidth < 900) els.detail.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function refreshAll(withEdit) {
    renderMeta();
    refreshLive();
    if (withEdit) renderEdit();
    if (withEdit) els.scroll.scrollLeft = 0;
  }

  function refreshLive() {
    const proc = P();
    const steps = getSteps(st.pid, shownVer());
    const m = metrics(proc, steps);
    if (!st.sel || !steps.some((s) => s.id === st.sel)) st.sel = defaultSel(proc, steps, m);
    renderKpis(m);
    renderCompare();
    renderMap(steps, m);
    renderLadder(steps, m);
    renderDetail();
    renderHours(steps, m);
  }

  // open on the bottleneck when a team owns it; otherwise on the internal step with the best automation fit
  function defaultSel(proc, steps, m) {
    const b = m.bottleneck ? steps.find((s) => s.id === m.bottleneck) : null;
    if (b && laneOf(proc, b.lane).kind === "internal") return b.id;
    let best = null, bestScore = -1;
    steps.forEach((s) => {
      const f = fitScore(s, m.per[s.id]);
      if (f && !f.na && f.score + m.per[s.id].laborShare > bestScore) { bestScore = f.score + m.per[s.id].laborShare; best = s.id; }
    });
    return best || (b && b.id) || (steps[0] && steps[0].id);
  }

  function revealCard(id) {
    const card = els.swim.querySelector('.wf-card[data-step="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!card) return;
    const sc = els.scroll;
    const laneW = (els.swim.querySelector(".wf-lane") || { offsetWidth: 0 }).offsetWidth;
    let left = 0, n = card;
    while (n && n !== els.swim) { left += n.offsetLeft; n = n.offsetParent; }
    if (left < sc.scrollLeft + laneW || left + card.offsetWidth > sc.scrollLeft + sc.clientWidth) {
      sc.scrollTo({ left: Math.max(0, left - laneW - 24), behavior: "smooth" });
    }
  }

  // ---------- header meta ----------
  function renderMeta() {
    const proc = P();
    const internal = proc.lanes.filter((l) => l.kind === "internal").map((l) => l.name);
    els.meta.innerHTML = `
      <span><b>Trigger:</b> ${UI.esc(proc.trigger)}</span>
      <span><b>Outcome:</b> ${UI.esc(proc.outcome)}</span>
      <span><b>Owner:</b> ${UI.esc(proc.owner)}</span>
      <span><b>Teams:</b> ${UI.esc(internal.join(", "))}</span>
      <span class="muted">Volumes from the last 4 weeks of operating data; timings are discovery estimates (Example) to confirm with each team.</span>`;
    els.say.textContent = proc.say;
  }

  // ---------- KPI tiles ----------
  function renderKpis(m) {
    const proc = P();
    let base = null, baseLabel = "";
    if (st.view === "compare") { base = metrics(proc, getSteps(st.pid, "current")); baseLabel = "vs. current"; }
    else if (isEdited(st.pid, shownVer())) { base = metrics(proc, clone(proc[shownVer()])); baseLabel = "vs. default map"; }
    const d = (a, b) => (base ? a - b : null);
    const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "");
    const tiles = [
      { label: "Lead time", value: fmtLead(m.lead), foot: proc.leadLabel, delta: d(m.lead, base && base.lead), deltaLabel: base ? sign(m.lead - base.lead) + fmtLead(Math.abs(m.lead - base.lead)) : "", goodWhen: "down" },
      { label: "Hands-on time", value: fmtLead(m.touch), foot: "work time on the critical path", delta: d(m.touch, base && base.touch), deltaLabel: base ? sign(m.touch - base.touch) + fmtLead(Math.abs(m.touch - base.touch)) : "", goodWhen: "down" },
      { label: "Process cycle efficiency", value: fmtPce(m.pce), foot: "hands-on ÷ lead time", delta: st.view === "compare" ? null : d(m.pce, base && base.pce), deltaLabel: base ? UI.fmt.pts(m.pce - base.pce, 2) : "", goodWhen: "up", keepFoot: st.view === "compare" ? "current " + fmtPce(base.pce) + "; hands-on ÷ lead" : "" },
      { label: "Handoffs", value: String(m.handoffs), foot: m.steps + " active steps", delta: d(m.handoffs, base && base.handoffs), deltaLabel: base ? UI.fmt.signed(m.handoffs - base.handoffs) : "", goodWhen: "down" },
      { label: "Manual steps", value: String(m.manual), foot: "a person does the work", delta: d(m.manual, base && base.manual), deltaLabel: base ? UI.fmt.signed(m.manual - base.manual) : "", goodWhen: "down" },
      { label: "Rework hours / month", value: UI.fmt.num(m.rework), foot: "repeated touches", delta: d(m.rework, base && base.rework), deltaLabel: base ? UI.fmt.signed(m.rework - base.rework) + " hrs" : "", goodWhen: "down" },
      { label: "Labor hours / month", value: UI.fmt.num(m.labor), foot: "internal teams", delta: d(m.labor, base && base.labor), deltaLabel: base ? UI.fmt.signed(m.labor - base.labor) + " hrs" : "", goodWhen: "down" },
      { label: "FTE equivalent", value: UI.fmt.dec(m.fte, 1), foot: "labor hours ÷ 160", delta: d(m.fte, base && base.fte), deltaLabel: base ? UI.fmt.signed(m.fte - base.fte, 1) + " FTE" : "", goodWhen: "down" },
    ];
    els.kpis.innerHTML = tiles.map((t) => {
      const o = Object.assign({}, t);
      if (base) o.foot = o.keepFoot || baseLabel;
      if (o.delta != null && Math.abs(o.delta) < 1e-6) o.deltaLabel = "no change";
      return UI.kpi(o);
    }).join("");
  }

  // ---------- compare section ----------
  function renderCompare() {
    if (st.view !== "compare") { els.compare.innerHTML = ""; delete charts.lead; delete charts.lanes; return; }
    const proc = P();
    const cs = getSteps(st.pid, "current"), fs = getSteps(st.pid, "future");
    const mc = metrics(proc, cs), mf = metrics(proc, fs);
    const rows = [
      { k: "Lead time", c: fmtLead(mc.lead), f: fmtLead(mf.lead), d: mf.lead - mc.lead, rel: mc.lead ? (mf.lead - mc.lead) / mc.lead : 0, fmt: (v) => fmtLead(Math.abs(v)) },
      { k: "Hands-on time", c: fmtLead(mc.touch), f: fmtLead(mf.touch), d: mf.touch - mc.touch, rel: mc.touch ? (mf.touch - mc.touch) / mc.touch : 0, fmt: (v) => fmtLead(Math.abs(v)) },
      { k: "Process cycle efficiency", c: fmtPce(mc.pce), f: fmtPce(mf.pce), d: mf.pce - mc.pce, neutral: true, fmt: (v) => Math.abs(v * 100).toFixed(2) + " pts" },
      { k: "Active steps", c: mc.steps, f: mf.steps, d: mf.steps - mc.steps, fmt: (v) => String(Math.abs(v)) },
      { k: "Handoffs", c: mc.handoffs, f: mf.handoffs, d: mf.handoffs - mc.handoffs, fmt: (v) => String(Math.abs(v)) },
      { k: "Manual steps", c: mc.manual, f: mf.manual, d: mf.manual - mc.manual, fmt: (v) => String(Math.abs(v)) },
      { k: "Rework hours / month", c: UI.fmt.num(mc.rework), f: UI.fmt.num(mf.rework), d: mf.rework - mc.rework, rel: mc.rework ? (mf.rework - mc.rework) / mc.rework : 0, fmt: (v) => UI.fmt.num(Math.abs(v)) + " hrs" },
      { k: "Labor hours / month", c: UI.fmt.num(mc.labor), f: UI.fmt.num(mf.labor), d: mf.labor - mc.labor, rel: mc.labor ? (mf.labor - mc.labor) / mc.labor : 0, fmt: (v) => UI.fmt.num(Math.abs(v)) + " hrs" },
      { k: "FTE equivalent", c: UI.fmt.dec(mc.fte, 1), f: UI.fmt.dec(mf.fte, 1), d: mf.fte - mc.fte, fmt: (v) => Math.abs(v).toFixed(1) + " FTE" },
    ];
    const chg = (r) => {
      if (Math.abs(r.d) < 1e-6) return UI.pill("neutral", "No change");
      const better = r.up ? r.d > 0 : r.d < 0;
      if (r.neutral) return `<span title="Hands-on ÷ lead time. It can fall when waste work is removed faster than waiting time.">${UI.pill("neutral", (r.d > 0 ? "+" : "−") + r.fmt(r.d))}</span>`;
      const txt = (r.d > 0 ? "+" : "−") + r.fmt(r.d) + (r.rel ? " (" + (r.rel > 0 ? "+" : "−") + Math.abs(r.rel * 100).toFixed(0) + "%)" : "");
      return UI.pill(better ? "good" : "critical", txt);
    };
    const mix = {};
    fs.forEach((s) => (mix[s.change] = (mix[s.change] || 0) + 1));
    const cById = {};
    cs.forEach((s) => (cById[s.id] = s));
    const changed = fs.map((s, i) => ({ s, i })).filter((x) => x.s.change !== "Unchanged" || (x.s.from && cById[x.s.from] && Math.abs(laborOf(mc, cById[x.s.from]) - laborOf(mf, x.s)) > 0.5));
    const hrsSaved = mc.labor - mf.labor;
    const fteSaved = hrsSaved / 160;
    els.compare.innerHTML = `
      <div class="grid g-2">
        <div class="panel">
          <div class="panel-head"><div><h3>Current vs. future state</h3><p class="panel-sub">${UI.esc(proc.name)}; every number recalculates when you edit either map.</p></div></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Metric</th><th class="num">Current</th><th class="num">Future</th><th>Change</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${UI.esc(r.k)}</td><td class="num">${UI.esc(r.c)}</td><td class="num">${UI.esc(r.f)}</td><td>${chg(r)}</td></tr>`).join("")}</tbody></table></div>
          <div class="wf-mix" aria-label="Future-state change mix">${CHANGE_TYPES.filter((t) => mix[t]).map((t) => `<span class="wf-chg ${CHANGE_CLS[t]}">${UI.esc(t)}: ${mix[t]}</span>`).join("")}</div>
          <div class="callout ${hrsSaved > 0 ? "good" : "warning"}"><div><strong>${hrsSaved >= 0 ? UI.fmt.num(hrsSaved) + " labor hours a month freed" : UI.fmt.num(-hrsSaved) + " more labor hours a month"}</strong>, about ${UI.fmt.dec(Math.abs(fteSaved), 1)} FTE of capacity, and lead time ${mf.lead <= mc.lead ? "drops" : "rises"} from ${UI.esc(fmtLead(mc.lead))} to ${UI.esc(fmtLead(mf.lead))}. ${mf.bottleneck ? "The bottleneck becomes <strong>" + UI.esc(stepName(fs, mf.bottleneck)) + "</strong>." : ""}</div></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Lead time: waiting vs. hands-on</h3><p class="panel-sub" id="wf-lead-sub"></p></div></div>
          <div class="chart-box sm"><canvas id="wf-lead-c" aria-label="Lead time split into waiting and hands-on time, current and future"></canvas></div>
          <div class="panel-head"><div><h3>Labor hours by team</h3><p class="panel-sub">Hours per month, current and future</p></div></div>
          <div class="chart-box sm"><canvas id="wf-lanes-c" aria-label="Labor hours per month by team, current and future"></canvas></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>What changes and why</h3><p class="panel-sub">Select a row to open the step. Hours compare each future step with the current step it replaces.</p></div></div>
        ${changed.length ? `<div class="table-wrap"><table class="data wf-change-list"><thead><tr><th class="num">#</th><th>Future step</th><th>Change</th><th>Why</th><th class="num">Hours / month</th></tr></thead><tbody>
          ${changed.map(({ s, i }) => {
            const src = s.from ? cById[s.from] : null;
            const before = src ? laborOf(mc, src) : 0;
            const after = isActive(s) ? laborOf(mf, s) : 0;
            const dh = after - before;
            return `<tr data-row-step="${UI.esc(s.id)}" style="cursor:pointer"><td class="num">${i + 1}</td><td><strong>${UI.esc(s.name)}</strong><div class="xs muted">${UI.esc(laneOf(proc, s.lane).name)}</div></td><td><span class="wf-chg ${CHANGE_CLS[s.change] || "same"}">${UI.esc(s.change)}</span></td><td class="small">${UI.esc(s.rationale || "")}</td><td class="num">${Math.abs(dh) < 0.5 ? "0" : (dh < 0 ? "−" : "+") + UI.fmt.num(Math.abs(dh))}</td></tr>`;
          }).join("")}</tbody></table></div>` : `<div class="empty">No differences between the two maps yet.</div>`}
        <div class="presenter-note">Compare is the business case in one screen: hours freed, lead time, and which step becomes the new constraint. Every redesigned step carries its reason, so a department lead can disagree with a specific line instead of the whole plan.</div>
      </div>`;

    const useDays = Math.max(mc.lead, mf.lead) >= 72;
    const u = (h) => Math.round((useDays ? h / 24 : h) * 10) / 10;
    const unit = useDays ? "days" : "hrs";
    const sub = els.compare.querySelector("#wf-lead-sub");
    if (sub) sub.textContent = "Per " + proc.unit + ", in " + unit;
    upsertChart("lead", "wf-lead-c", {
      type: "bar",
      data: {
        labels: ["Current", "Future"],
        datasets: [
          { label: "Waiting", data: [u(mc.wait), u(mf.wait)], backgroundColor: UI.series(0), stack: "t" },
          { label: "Hands-on", data: [u(mc.touch), u(mf.touch)], backgroundColor: UI.series(1), stack: "t" },
        ],
      },
      options: {
        indexAxis: "y",
        scales: { x: { stacked: true, beginAtZero: true, title: { display: true, text: unit } }, y: { stacked: true, grid: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ": " + c.raw + " " + unit } } },
      },
    });
    const lanes = proc.lanes.filter((l) => l.kind === "internal");
    upsertChart("lanes", "wf-lanes-c", {
      type: "bar",
      data: {
        labels: lanes.map((l) => l.name),
        datasets: [
          { label: "Current", data: lanes.map((l) => Math.round(mc.laborByLane[l.id] || 0)), backgroundColor: UI.series(0) },
          { label: "Future", data: lanes.map((l) => Math.round(mf.laborByLane[l.id] || 0)), backgroundColor: UI.series(1) },
        ],
      },
      options: {
        scales: { y: { beginAtZero: true, title: { display: true, text: "hrs / month" } }, x: { grid: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ": " + UI.fmt.num(c.raw) + " hrs" } } },
      },
    });
  }
  const laborOf = (m, s) => (m.per[s.id] ? m.per[s.id].labor : 0);
  const stepName = (steps, id) => { const i = steps.findIndex((s) => s.id === id); return i < 0 ? "" : i + 1 + ". " + steps[i].name; };

  // ---------- swimlane map ----------
  function renderMap(steps, m) {
    const proc = P();
    const ver = shownVer();
    const edited = isEdited(st.pid, ver);
    els.mapTitle.textContent = st.view === "compare" ? "Future state, marked against current" : ver === "future" ? "Future state (redesigned)" : "Current state (as the work happens today)";
    els.mapSub.innerHTML = `${steps.filter(isActive).length} active steps across ${proc.lanes.length} lanes. Select a step for detail<span class="wf-hint" hidden>; scroll sideways or use the lead-time bar below to jump to any step</span>.${edited ? " " + UI.pill("accent", "Edited in this browser") : ""}`;

    const laneRow = {};
    proc.lanes.forEach((l, i) => (laneRow[l.id] = i + 1));
    let col = 0;
    const colOf = steps.map((s, i) => { if (i === 0 || !s.parallel) col++; return col; });
    const cells = {};
    steps.forEach((s, i) => {
      const r = laneRow[s.lane] || 1;
      const key = r + ":" + colOf[i];
      (cells[key] = cells[key] || { r, c: colOf[i], items: [] }).items.push(i);
    });
    els.swim.style.gridTemplateColumns = "var(--wf-lane-w) repeat(" + col + ", var(--wf-col-w))";
    els.swim.style.gridTemplateRows = "repeat(" + proc.lanes.length + ", minmax(var(--wf-row-h), auto))";
    const bands = proc.lanes.map((l, i) => `<div class="wf-band${i % 2 ? " alt" : ""}" style="grid-row:${i + 1}"></div>`).join("");
    const labels = proc.lanes.map((l, i) => `<div class="wf-lane${i % 2 ? " alt" : ""}" style="grid-row:${i + 1};grid-column:1"><b>${UI.esc(l.name)}</b><small>${l.kind === "external" ? "External" : "Team"}</small></div>`).join("");
    const cards = Object.keys(cells).map((k) => {
      const c = cells[k];
      return `<div class="wf-cell" style="grid-row:${c.r};grid-column:${c.c + 1}">${c.items.map((i) => cardHtml(proc, steps[i], i, m)).join("")}</div>`;
    }).join("");
    els.swim.innerHTML = bands + labels + `<svg class="wf-svg" aria-hidden="true" focusable="false"></svg>` + cards;
    els.swim._cols = colOf;
    els.swim._steps = steps;
    requestAnimationFrame(() => {
      drawEdges();
      const hint = els.mapSub.querySelector(".wf-hint");
      if (hint) hint.hidden = els.scroll.scrollWidth <= els.scroll.clientWidth + 2;
    });

    // insight callout
    const b = m.bottleneck ? steps.find((s) => s.id === m.bottleneck) : null;
    const h = m.hot ? steps.find((s) => s.id === m.hot) : null;
    const idx = (s) => steps.indexOf(s) + 1;
    els.callout.innerHTML = b || h ? `<div class="callout wf-insight"><div class="wf-ins-body">
      ${b ? `<span>${UI.pill("critical", "Bottleneck")} Step ${idx(b)}, <strong>${UI.esc(b.name)}</strong>, holds ${UI.fmt.pct(m.per[b.id].share, 0)} of lead time (${UI.esc(fmtLead(m.per[b.id].contrib))} of ${UI.esc(fmtLead(m.lead))}).</span>` : ""}
      ${h ? `<span>${UI.pill("serious", "Most labor")} Step ${idx(h)}, <strong>${UI.esc(h.name)}</strong>, uses ${UI.fmt.num(m.per[h.id].labor)} hrs a month (${UI.fmt.dec(m.per[h.id].labor / 160, 1)} FTE).</span>` : ""}
    </div></div>` : "";
  }

  function cardHtml(proc, s, i, m) {
    const p = m.per[s.id];
    const ghost = !isActive(s);
    const lane = laneOf(proc, s.lane);
    const ext = lane.kind === "external";
    const isB = !ghost && m.bottleneck === s.id;
    const isH = !ghost && !isB && m.hot === s.id;
    const cls = ["wf-card"];
    if (ghost) cls.push("is-ghost");
    if (ext) cls.push("is-ext");
    if (isB) cls.push("is-bneck");
    else if (isH) cls.push("is-hot");
    else if (!ghost && s.waitHrs >= 24) cls.push("is-wait");
    if (st.sel === s.id) cls.push("is-sel");
    const flag = isB ? `<span class="wf-flag crit" title="${UI.fmt.pct(p.share, 0)} of lead time">■ Bottleneck · ${UI.fmt.pct(p.share, 0)}</span>`
      : isH ? `<span class="wf-flag ser" title="${UI.fmt.num(p.labor)} labor hours a month">◆ Most labor · ${UI.fmt.compact(p.labor)} h</span>` : "";
    const stats = [];
    if (!ext || s.touchMin) stats.push(`<span>${UI.esc(fmtMin(s.touchMin))}</span>`);
    if (s.reworkPct > 0) stats.push(`<span>Rework ${UI.fmt.pct(s.reworkPct, 0)}</span>`);
    if (s.pathPct != null && s.pathPct < 1) stats.push(`<span class="wf-branch">${UI.fmt.pct(s.pathPct, 0)} of ${UI.esc(proc.unit)}s</span>`);
    if (s.decision) stats.push(`<span>Decision</span>`);
    if (s.batch) stats.push(`<span>Batch</span>`);
    if (s.manual && !ghost) stats.push(`<span>Manual</span>`);
    const chg = st.view !== "current" && s.change ? `<span class="wf-chg ${CHANGE_CLS[s.change] || "same"}">${UI.esc(s.change)}</span>` : "";
    const label = `Step ${i + 1}: ${s.name}. ${lane.name}. ${ghost ? "Eliminated." : "Wait " + fmtWait(s.waitHrs, true) + ", hands-on " + fmtMin(s.touchMin) + "."}${isB ? " Bottleneck." : ""}${isH ? " Most labor." : ""}${s.change && st.view !== "current" ? " " + s.change + "." : ""}`;
    return `<button type="button" class="${cls.join(" ")}" data-pick="${UI.esc(s.id)}" data-step="${UI.esc(s.id)}" aria-pressed="${st.sel === s.id}" aria-label="${UI.esc(label)}">
      ${flag}
      <span class="wf-top"><span class="wf-num">${i + 1}</span><span class="wf-wait${s.waitHrs >= 24 && !ghost ? " long" : ""}">${ghost ? "Removed" : s.waitHrs ? "Wait " + UI.esc(fmtWait(s.waitHrs)) : "No wait"}</span></span>
      <span class="wf-name">${UI.esc(s.name)}</span>
      <span class="wf-sys">${UI.esc(s.system || "")}</span>
      <span class="wf-stats">${stats.join("")}</span>
      ${chg}
    </button>`;
  }

  function drawEdges() {
    const swim = els.swim;
    if (!swim || !swim.isConnected) return;
    const svg = swim.querySelector(".wf-svg");
    const steps = swim._steps, cols = swim._cols;
    if (!svg || !steps) return;
    const W = swim.scrollWidth, H = swim.scrollHeight;
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    const cards = {};
    swim.querySelectorAll(".wf-card").forEach((c) => (cards[c.dataset.step] = c));
    const byCol = {};
    steps.forEach((s, i) => (byCol[cols[i]] = byCol[cols[i]] || []).push(s));
    const box = (el) => {
      // offsets relative to the swim grid (cards sit in static cells, so offsetParent is the grid)
      let l = 0, t = 0, n = el;
      while (n && n !== swim) { l += n.offsetLeft; t += n.offsetTop; n = n.offsetParent; }
      return { l, t, w: el.offsetWidth, h: el.offsetHeight };
    };
    let out = "";
    const maxCol = cols.length ? cols[cols.length - 1] : 0;
    for (let c = 1; c < maxCol; c++) {
      (byCol[c] || []).forEach((a) => {
        (byCol[c + 1] || []).forEach((b) => {
          const ea = cards[a.id], eb = cards[b.id];
          if (!ea || !eb) return;
          const A = box(ea), B = box(eb);
          const x1 = A.l + A.w, y1 = A.t + A.h / 2, x2 = B.l, y2 = B.t + B.h / 2;
          const dash = !isActive(a) || !isActive(b) ? " dash" : "";
          out += `<path class="wf-edge${dash}" d="${elbow(x1, y1, x2, y2)}"/>`;
          out += `<path class="wf-arrowhead" d="M${x2 - 7},${y2 - 4} L${x2 - 1},${y2} L${x2 - 7},${y2 + 4} Z"/>`;
          if (b.handoff && isActive(b)) {
            // marker sits on the last horizontal run, inside the receiving lane
            const xm = Math.abs(y1 - y2) < 1 ? (x1 + x2) / 2 : ((x1 + x2) / 2 + x2) / 2;
            const ym = y2;
            out += `<rect class="wf-hand" x="${xm - 4.5}" y="${ym - 4.5}" width="9" height="9" transform="rotate(45 ${xm} ${ym})"/>`;
          }
        });
      });
    }
    svg.innerHTML = out;
  }
  function elbow(x1, y1, x2, y2) {
    if (Math.abs(y1 - y2) < 1) return `M${x1},${y1} H${x2 - 2}`;
    const xm = (x1 + x2) / 2;
    const r = Math.max(0, Math.min(8, Math.abs(y2 - y1) / 2, (x2 - x1) / 2 - 1));
    const dir = y2 > y1 ? 1 : -1;
    return `M${x1},${y1} H${xm - r} Q${xm},${y1} ${xm},${y1 + dir * r} V${y2 - dir * r} Q${xm},${y2} ${xm + r},${y2} H${x2 - 2}`;
  }

  // ---------- lead-time ladder ----------
  function renderLadder(steps, m) {
    if (!m.lead) { els.ladder.innerHTML = `<div class="empty">No wait or hands-on time recorded yet. Add timings in edit mode.</div>`; return; }
    const crit = steps.map((s, i) => ({ s, i })).filter((x) => isActive(x.s) && m.per[x.s.id].critical && m.per[x.s.id].contrib > 0);
    const top = crit.slice().sort((a, b) => m.per[b.s.id].contrib - m.per[a.s.id].contrib).slice(0, 3);
    els.ladder.innerHTML = `<div class="wf-ladder-wrap">
      <div class="label">Where the lead time goes (each block is one step on the critical path)</div>
      <div class="wf-ladder">${crit.map((x, k) => {
        const p = m.per[x.s.id];
        const isB = m.bottleneck === x.s.id;
        return `<button type="button" class="wf-seg${k % 2 ? " alt" : ""}${isB ? " is-b" : ""}${st.sel === x.s.id ? " is-sel" : ""}" style="flex-grow:${Math.max(0.0001, p.share).toFixed(4)}" data-pick="${UI.esc(x.s.id)}" title="${UI.esc(x.i + 1 + ". " + x.s.name + ": " + fmtLead(p.contrib) + " (" + UI.fmt.pct(p.share, 0) + ")")}" aria-label="${UI.esc("Step " + (x.i + 1) + ", " + x.s.name + ", " + UI.fmt.pct(p.share, 0) + " of lead time")}">${p.share >= 0.05 ? x.i + 1 : ""}</button>`;
      }).join("")}</div>
      <div class="wf-ladder-foot"><span><b>Lead time ${UI.esc(fmtLead(m.lead))}</b> · hands-on ${UI.esc(fmtLead(m.touch))} (${fmtPce(m.pce)})</span>
      <span>Biggest delays: ${top.map((x) => `${x.i + 1}. ${UI.esc(trunc(x.s.name, 38))} (${UI.fmt.pct(m.per[x.s.id].share, 0)})`).join(" · ")}</span></div>
    </div>`;
  }

  // ---------- step detail ----------
  function renderDetail() {
    const proc = P();
    const ver = shownVer();
    const steps = getSteps(st.pid, ver);
    const s = steps.find((x) => x.id === st.sel) || steps[0];
    if (!s) { els.detail.innerHTML = `<div class="empty">Select a step on the map.</div>`; return; }
    const m = metrics(proc, steps);
    const p = m.per[s.id];
    const i = steps.indexOf(s);
    const lane = laneOf(proc, s.lane);
    const other = getSteps(st.pid, ver === "future" ? "current" : "future");
    const twin = ver === "future" ? (s.from ? other.find((c) => c.id === s.from) : null) : other.find((f) => f.from === s.id) || null;
    const mo = metrics(proc, other);
    const ghost = !isActive(s);
    const fit = fitScore(s, p);
    const existing = OPS.opps.all().find((o) => o.source === "workflow" && o.processId === proc.id && o.stepId === oppStepKey(s, ver));
    const showDelta = st.view === "compare" && twin;
    const fact = (label, now, before) => `<div><dt>${UI.esc(label)}</dt><dd>${showDelta && before != null && before !== now ? `<s>${UI.esc(before)}</s>` : ""}${UI.esc(now)}</dd></div>`;
    const tw = twin && isActive(twin) ? mo.per[twin.id] : null;
    const facts = ghost
      ? `${fact("Hands-on before", fmtMin(s.touchMin))}${fact("Wait before", fmtWait(s.waitHrs, true))}${fact("Volume before", UI.fmt.num(s.volumePerMonth) + " " + volUnit(proc, s))}`
      : [
        fact("Hands-on per " + (s.volUnit ? s.volUnit.replace(/s$/, "") : proc.unit), fmtMin(s.touchMin), twin ? fmtMin(twin.touchMin) : null),
        fact("Wait before step", fmtWait(s.waitHrs, true), twin ? fmtWait(twin.waitHrs, true) : null),
        fact("Rework", UI.fmt.pct(s.reworkPct, 0), twin ? UI.fmt.pct(twin.reworkPct, 0) : null),
        fact("Volume / month", UI.fmt.num(s.volumePerMonth) + " " + volUnit(proc, s), twin ? UI.fmt.num(twin.volumePerMonth) + " " + volUnit(proc, twin) : null),
        p.ext ? fact("Labor", "External") : fact("Labor / month", UI.fmt.num(p.labor) + " hrs", tw ? UI.fmt.num(tw.labor) + " hrs" : twin ? "0 hrs" : null),
        fact("Share of lead time", p.critical ? UI.fmt.pct(p.share, 0) : "Runs in parallel"),
        s.pathPct != null && s.pathPct < 1 ? fact("Share of " + proc.unit + "s", UI.fmt.pct(s.pathPct, 0)) : "",
      ].join("");
    const badges = [UI.tag(lane.name), s.system ? UI.tag(s.system) : ""];
    if (s.change && ver === "future") badges.push(`<span class="wf-chg ${CHANGE_CLS[s.change] || "same"}">${UI.esc(s.change)}</span>`);
    if (m.bottleneck === s.id) badges.push(UI.pill("critical", "Bottleneck"));
    if (m.hot === s.id) badges.push(UI.pill("serious", "Most labor"));
    if (s.decision) badges.push(UI.pill("neutral", "Decision"));
    if (s.handoff) badges.push(UI.pill("accent", "Handoff in"));

    let fitHtml;
    if (ghost) fitHtml = `<div class="callout"><div><strong>Removed in the redesign.</strong> ${UI.esc(s.rationale || "")}</div></div>`;
    else if (!fit || fit.na) fitHtml = `<p class="small muted">External step, so the automation-fit score does not apply. Improve it through the contract, the data spec, or the relationship with the plan.</p>`;
    else {
      const bar = (label, v) => `<span>${UI.esc(label)}</span><span class="bar" role="img" aria-label="${UI.esc(label)} ${Math.round(v * 100)} of 100"><i style="width:${Math.round(v * 100)}%"></i></span><span class="num">${Math.round(v * 100)}</span>`;
      fitHtml = `<div class="wf-fit">
        <div class="wf-fit-score"><span class="wf-fit-num">${fit.score}<small>/100</small></span>${UI.pill(fit.band.level, fit.band.text)}</div>
        <div class="stack" style="gap:8px">
          <div class="wf-factors">${bar("Manual work", fit.manual)}${bar("Repetitive volume", fit.volume)}${bar("Rule-based", fit.rules)}${bar("Low judgment", fit.lowJ)}</div>
          <p class="small">${UI.esc(fit.why)}</p>
          <p class="small"><strong>Best approach:</strong> ${UI.esc(fit.approach)}</p>
        </div>
      </div>`;
    }
    const canSend = !lane || lane.kind !== "external";
    els.detail.innerHTML = `
      <div class="wf-detail-head">
        <div class="label">Step ${i + 1} of ${steps.length} · ${ver === "future" ? "future state" : "current state"}</div>
        <h3>${UI.esc(s.name)}</h3>
        <div class="row">${badges.join("")}</div>
      </div>
      <dl class="wf-facts">${facts}</dl>
      ${s.note ? `<p class="small">${UI.esc(s.note)}</p>` : ""}
      ${ver === "future" && s.rationale && !ghost ? `<div class="callout accent"><div><strong>Why this changes:</strong> ${UI.esc(s.rationale)}</div></div>` : ""}
      ${ver === "current" && twin && twin.change !== "Unchanged" ? `<div class="callout accent"><div><strong>In the redesign:</strong> ${UI.esc(twin.change)}. ${UI.esc(twin.rationale || "")}</div></div>` : ""}
      ${s.questions && s.questions.length ? `<div class="stack" style="gap:6px"><div class="label">Discovery questions for this step</div><ol class="wf-qs">${s.questions.map((q) => `<li>${UI.esc(q)}</li>`).join("")}</ol></div>` : ""}
      <div class="stack" style="gap:8px"><div class="label">Automation fit</div>${fitHtml}</div>
      <div class="wf-actions">
        ${canSend ? `<button type="button" class="btn primary" data-act="send" data-step="${UI.esc(s.id)}">${UI.icon("arrow")}<span>${existing ? "Update in pipeline" : "Send to pipeline"}</span></button>` : `<button type="button" class="btn" disabled>${UI.icon("arrow")}<span>External step</span></button>`}
        <span class="wf-status" id="wf-status">${existing ? `In the pipeline as <a href="#pipeline" data-act="open-pipe" data-opp="${UI.esc(existing.id)}">${UI.esc(existing.id)}</a> (${UI.esc(existing.stage || "Backlog")}).` : canSend ? "Creates an opportunity with the hours estimate and the redesign attached." : ""}</span>
      </div>`;
  }

  // ---------- pipeline hand-off ----------
  const oppStepKey = (s, ver) => (ver === "future" ? s.from || s.id : s.id);
  function sendToPipeline(stepId) {
    const proc = P();
    const ver = shownVer();
    const steps = getSteps(st.pid, ver);
    const s = steps.find((x) => x.id === stepId);
    if (!s) return;
    const cur = getSteps(st.pid, "current"), fut = getSteps(st.pid, "future");
    const mc = metrics(proc, cur), mf = metrics(proc, fut);
    const curS = ver === "current" ? s : s.from ? cur.find((c) => c.id === s.from) : null;
    const futS = ver === "future" ? s : fut.find((f) => f.from === s.id) || null;
    const ref = curS || s;
    const refM = curS ? mc : mf;
    const p = refM.per[ref.id] || { labor: 0 };
    const fit = fitScore(ref, refM.per[ref.id]);
    const aKey = fit && !fit.na ? fit.aKey : "flow";
    const redesigned = futS && futS.change !== "Unchanged";
    const curLabor = curS ? laborOf(mc, curS) : 0;
    const futLabor = futS && isActive(futS) ? laborOf(mf, futS) : 0;
    let saved = redesigned && curS ? curLabor - futLabor : p.labor * ({ auto: 0.8, ai: 0.55, flow: 0.3, human: 0.15, tune: 0.1 }[aKey] || 0.3);
    saved = Math.max(0, Math.round(saved));
    const prefix = { auto: "Automate", ai: "AI-assist", flow: "Streamline", human: "Support", tune: "Tune" }[aKey];
    const title = redesigned ? (futS.change === "Eliminated" ? "Eliminate: " + (curS ? curS.name : futS.name) : futS.name) : prefix + ": " + ref.name;
    const changeType = redesigned ? futS.change : aKey === "ai" ? "AI-assisted" : aKey === "auto" ? "Automated" : "";
    const isB = mc.bottleneck === (curS && curS.id);
    const impact = Math.min(5, (saved >= 300 ? 5 : saved >= 120 ? 4 : saved >= 40 ? 3 : saved >= 10 ? 2 : 1) + (isB ? 1 : 0));
    const rules = ref.rules == null ? 0.5 : ref.rules;
    const lane = laneOf(proc, ref.lane);
    const problem = curS
      ? `${curS.note} Today: ${fmtMin(curS.touchMin)} hands-on, ${fmtWait(curS.waitHrs, true).toLowerCase()} of wait, ${UI.fmt.pct(curS.reworkPct, 0)} rework, ${UI.fmt.num(curS.volumePerMonth)} ${volUnit(proc, curS)} a month (${UI.fmt.num(curLabor)} labor hrs).`
      : s.note || "New step added in the future-state map.";
    const solution = redesigned ? futS.rationale || futS.name : fit && !fit.na ? fit.approach : "Redesign with the team that owns the step.";
    const existing = OPS.opps.all().find((o) => o.source === "workflow" && o.processId === proc.id && o.stepId === ref.id);
    const rec = OPS.opps.save(Object.assign({}, existing || {}, {
      title,
      dept: lane.dept || proc.dept,
      problem,
      solution,
      kpi: ref.kpi || proc.kpi,
      impact,
      confidence: Math.min(5, 3 + (rules >= 0.7 ? 1 : 0)),
      effort: { auto: 3, ai: 3, flow: 2, human: 2, tune: 1 }[aKey] || 2,
      risk: changeType === "AI-assisted" ? "High" : changeType === "Automated" || changeType === "Human-in-the-loop" ? "Medium" : "Low",
      hoursSavedPerMonth: saved,
      owner: lane.lead,
      tools: String((futS && redesigned ? futS.system : ref.system) || "").split(/,\s*/).filter(Boolean),
      source: "workflow",
      processId: proc.id,
      stepId: ref.id,
      stage: existing ? existing.stage : "Backlog",
    }));
    toastLink((existing ? "Updated " : "Added ") + rec.id + " to the pipeline · " + UI.fmt.num(saved) + " hrs/month", rec.id);
    renderDetail();
  }
  function toastLink(msg, id) {
    UI.toast(msg, 6500);
    const host = document.querySelector(".toasts");
    const t = host && host.lastElementChild;
    if (!t) return;
    const a = document.createElement("a");
    a.href = "#pipeline";
    a.className = "wf-toast-link";
    a.textContent = "Open pipeline";
    a.addEventListener("click", (e) => { e.preventDefault(); OPS.navigate("pipeline", { opp: id }); });
    t.appendChild(document.createTextNode(" "));
    t.appendChild(a);
  }

  // ---------- hours chart ----------
  function renderHours(steps, m) {
    const proc = P();
    const rows = steps.map((s, i) => ({ s, i })).filter((x) => isActive(x.s) && m.per[x.s.id] && !m.per[x.s.id].ext);
    const narrow = window.innerWidth < 560;
    els.hoursBox.style.height = Math.max(200, rows.length * 30 + 70) + "px";
    els.hoursSub.textContent = `${proc.short}, ${shownVer() === "future" ? "future" : "current"} state: hands-on and rework hours per month by step, internal teams only`;
    upsertChart("hours", "wf-hours-c", {
      type: "bar",
      data: {
        labels: rows.map((x) => x.i + 1 + ". " + trunc(x.s.name, narrow ? 20 : 34)),
        datasets: [
          { label: "Hands-on hours", data: rows.map((x) => Math.round(m.per[x.s.id].labor - m.per[x.s.id].rework)), backgroundColor: UI.series(0), stack: "h" },
          { label: "Rework hours", data: rows.map((x) => Math.round(m.per[x.s.id].rework)), backgroundColor: UI.series(1), stack: "h" },
        ],
      },
      options: {
        indexAxis: "y",
        scales: { x: { stacked: true, beginAtZero: true, title: { display: true, text: "hrs / month" } }, y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, font: { size: narrow ? 10 : 11 } } } },
        plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ": " + UI.fmt.num(c.raw) + " hrs" } } },
      },
    });
  }

  // ---------- edit mode ----------
  function renderEdit() {
    if (!st.edit) { els.edit.innerHTML = ""; return; }
    const proc = P();
    const ver = editVer();
    const steps = getSteps(st.pid, ver);
    const num = (v, d) => (v == null ? "" : String(Math.round(v * Math.pow(10, d)) / Math.pow(10, d)));
    const laneOpts = (sel) => proc.lanes.map((l) => `<option value="${UI.esc(l.id)}"${l.id === sel ? " selected" : ""}>${UI.esc(l.name)}</option>`).join("");
    const chgOpts = (sel) => CHANGE_TYPES.map((t) => `<option value="${UI.esc(t)}"${t === sel ? " selected" : ""}>${UI.esc(t)}</option>`).join("");
    const rows = steps.map((s, i) => {
      const n = i + 1;
      const elim = ver === "future" && s.change === "Eliminated";
      const dis = elim ? " disabled" : "";
      return `<tr data-i="${i}" data-sid="${UI.esc(s.id)}" class="${st.sel === s.id ? "is-sel" : ""}${elim ? " is-elim" : ""}">
        <td class="num">${n}</td>
        <td><input class="input wf-in wf-in-name" data-f="name" type="text" value="${UI.esc(s.name)}" aria-label="Step ${n} name"></td>
        <td><select class="select wf-in" data-f="lane" aria-label="Step ${n} lane">${laneOpts(s.lane)}</select></td>
        ${ver === "future" ? `<td><select class="select wf-in" data-f="change" aria-label="Step ${n} change type">${chgOpts(s.change)}</select></td>` : ""}
        <td class="num"><input class="input wf-in wf-in-num" data-f="touchMin" type="number" min="0" step="0.1" inputmode="decimal" value="${num(s.touchMin, 2)}" aria-label="Step ${n} hands-on minutes"${dis}></td>
        <td class="num"><input class="input wf-in wf-in-num" data-f="waitHrs" type="number" min="0" step="1" inputmode="decimal" value="${num(s.waitHrs, 1)}" aria-label="Step ${n} wait hours"${dis}></td>
        <td class="num"><input class="input wf-in wf-in-num" data-f="reworkPct" type="number" min="0" max="100" step="1" inputmode="decimal" value="${num((s.reworkPct || 0) * 100, 1)}" aria-label="Step ${n} rework percent"${dis}></td>
        <td class="num"><input class="input wf-in wf-in-num" data-f="volumePerMonth" type="number" min="0" step="10" inputmode="numeric" value="${num(s.volumePerMonth, 0)}" aria-label="Step ${n} volume per month"${dis}></td>
        <td style="text-align:center"><input class="wf-in" data-f="manual" type="checkbox"${s.manual ? " checked" : ""} aria-label="Step ${n} is manual"${dis}></td>
        <td style="text-align:center"><input class="wf-in" data-f="handoff" type="checkbox"${s.handoff ? " checked" : ""} aria-label="Step ${n} starts with a handoff"${dis}></td>
        <td><button type="button" class="btn ghost sm" data-act="remove" data-i="${i}" aria-label="Remove step ${n}">${UI.icon("x")}</button></td>
      </tr>`;
    }).join("");
    const edited = isEdited(st.pid, ver);
    els.edit.innerHTML = `<div class="panel">
      <div class="panel-head">
        <div><h3>Edit the ${ver === "future" ? "future" : "current"} state</h3><p class="panel-sub">Change a number and watch the bottleneck, the ladder, and the hours move. Edits save in this browser for this process.</p></div>
        <div class="wf-edit-head-actions">
          ${st.view === "compare" ? UI.seg("wf-edit-ver", [{ value: "current", label: "Edit current" }, { value: "future", label: "Edit future" }], ver) : ""}
          <button type="button" class="btn sm" data-act="add">${UI.icon("plus")}<span>Add step after selected</span></button>
          ${st.confirmReset
            ? `<button type="button" class="btn sm wf-danger" data-act="reset-confirm">Confirm reset</button><button type="button" class="btn ghost sm" data-act="reset-cancel">Cancel</button>`
            : `<button type="button" class="btn ghost sm" data-act="reset"${edited ? "" : " disabled"}>Reset to default</button>`}
        </div>
      </div>
      <div class="table-wrap"><table class="data wf-edit-table">
        <thead><tr><th class="num">#</th><th>Step</th><th>Lane</th>${ver === "future" ? "<th>Change</th>" : ""}<th class="num">Hands-on min</th><th class="num">Wait hrs</th><th class="num">Rework %</th><th class="num">Volume / mo</th><th>Manual</th><th>Handoff</th><th>Remove</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="xs muted">Hands-on minutes are per unit of volume (per file, call, chart, or roster). Wait is the queue time before the step starts. Try it: cut the wait on the bottleneck step and see which step takes its place.</p>
      <div class="presenter-note">Here is the part I use in the room: change one number with the team watching. Cut the bottleneck's wait and the constraint jumps to the next step, which is the real conversation about what to fix first and what it is worth in hours.</div>
    </div>`;
    if (st.view === "compare") UI.wireSeg(els.edit, "wf-edit-ver", (v) => { st.editTarget = v; st.confirmReset = false; renderEdit(); });
  }

  function wireEdit() {
    const onField = (e, el) => {
      const tr = el.closest("tr[data-i]");
      if (!tr) return;
      const isText = el.type === "text" || el.type === "number";
      if (e.type === "change" && isText) return; // handled on input
      if (e.type === "input" && !isText) return; // selects / checkboxes handled on change
      const ver = editVer();
      const steps = getSteps(st.pid, ver);
      const s = steps[+tr.dataset.i];
      if (!s) return;
      const f = el.dataset.f;
      if (f === "name") s.name = el.value.trim() || "Untitled step";
      else if (f === "lane" || f === "change") s[f] = el.value;
      else if (f === "manual" || f === "handoff") s[f] = el.checked;
      else {
        let v = parseFloat(el.value);
        if (!isFinite(v) || v < 0) v = 0;
        if (f === "reworkPct") v = Math.min(100, v) / 100;
        s[f] = v;
      }
      saveSteps(st.pid, ver, steps);
      if (f === "change") { renderEdit(); }
      else {
        const rb = els.edit.querySelector("[data-act='reset']");
        if (rb) rb.disabled = false;
      }
      if (ver === shownVer() || st.view === "compare") refreshLive();
    };
    els.edit.addEventListener("input", (e) => { const el = e.target.closest(".wf-in"); if (el) onField(e, el); });
    els.edit.addEventListener("change", (e) => { const el = e.target.closest(".wf-in"); if (el) onField(e, el); });
    UI.on(els.edit, "click", "[data-act]", (e, el) => {
      const act = el.dataset.act;
      const ver = editVer();
      if (act === "add") {
        const steps = getSteps(st.pid, ver);
        let at = steps.findIndex((s) => s.id === st.sel);
        if (at < 0) at = steps.length - 1;
        const ref = steps[at] || steps[steps.length - 1];
        const ns = Object.assign({}, BASE, {
          id: "u" + Date.now().toString(36),
          lane: ref ? ref.lane : P().lanes[0].id,
          name: "New step",
          system: "To be confirmed",
          touchMin: 5, waitHrs: 4, reworkPct: 0,
          volumePerMonth: ref ? ref.volumePerMonth : 100,
          volUnit: ref ? ref.volUnit : undefined,
          manual: true, handoff: false,
          note: "Added in edit mode. Confirm the timings with the people who do this work.",
          questions: ["Who does this step today, and what triggers it?", "What breaks downstream if this step is skipped or late?"],
        });
        if (ver === "future") { ns.change = "Unchanged"; ns.rationale = "Added in edit mode."; }
        steps.splice(at + 1, 0, ns);
        saveSteps(st.pid, ver, steps);
        if (ver === shownVer()) st.sel = ns.id;
        st.confirmReset = false;
        renderEdit();
        refreshLive();
        const inp = els.edit.querySelector(`tr[data-sid="${ns.id}"] .wf-in-name`);
        if (inp) { inp.focus(); inp.select(); }
      } else if (act === "remove") {
        const steps = getSteps(st.pid, ver);
        if (steps.length <= 2) { UI.toast("A process needs at least two steps."); return; }
        const [gone] = steps.splice(+el.dataset.i, 1);
        saveSteps(st.pid, ver, steps);
        if (gone && st.sel === gone.id) st.sel = null;
        renderEdit();
        refreshLive();
      } else if (act === "reset") {
        st.confirmReset = true;
        renderEdit();
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => { if (st && st.confirmReset) { st.confirmReset = false; renderEdit(); } }, 5000);
        const c = els.edit.querySelector("[data-act='reset-confirm']");
        if (c) c.focus();
      } else if (act === "reset-cancel") {
        st.confirmReset = false;
        renderEdit();
      } else if (act === "reset-confirm") {
        resetSteps(st.pid, ver);
        st.confirmReset = false;
        st.sel = null;
        renderEdit();
        refreshLive();
        UI.toast("Map reset to the default " + (ver === "future" ? "future" : "current") + " state.");
      }
    });
  }

  OPS.register({
    id: "workflow",
    title: "Workflow Mapper",
    stage: "discover",
    order: 20,
    icon: "flow",
    summary: "Map how work actually moves across teams and systems, find the step that holds everything up, and test a redesign with live metrics before anyone changes a system.",
    jd: [
      "Map how work actually gets done, identify bottlenecks",
      "Redesign processes to improve productivity, accuracy, speed",
      "Streamline internal handoffs and cross-departmental workflows",
      "Quantify the impact of process improvements",
    ],
    render,
    destroy() { cleanup(); },
  });
})();
