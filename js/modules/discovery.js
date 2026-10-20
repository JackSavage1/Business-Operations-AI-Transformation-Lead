/* Throughline: Discovery Kit.
 * Department interview guides (who to meet, sharp questions, what to listen for, data to request,
 * a 2-hour shadowing tally), an interview capture log that promotes pain points into the shared
 * opportunity store, and a live synthesis of what the notes say so far. */
(function () {
  "use strict";
  const UI = window.UI;
  const OPS = window.OPS;

  const KEY_NOTES = "discovery.notes.v1";
  const KEY_SHADOW = "discovery.shadow.v1";
  const KEY_DEPT = "discovery.dept";

  const TYPES = ["Delay", "Rework", "Handoff", "Manual entry", "Data quality", "Compliance risk", "Tooling"];
  const FREQS = ["Every call or visit", "Daily", "Weekly", "Monthly"];
  const TALLY = [
    { id: "handoffs", label: "Handoffs", hint: "work passes to another person or team" },
    { id: "rekey", label: "Swivel-chair re-keying", hint: "same data typed into a second system" },
    { id: "rework", label: "Rework loops", hint: "work sent back to be fixed" },
    { id: "waits", label: "Wait states", hint: "work sits waiting for someone or something" },
    { id: "workarounds", label: "Workarounds & side spreadsheets", hint: "personal trackers, sticky notes, shadow tools" },
  ];

  const DEPTS = [
    {
      id: "ops", name: "Operations leadership", oppDept: "Operations", owner: "VP Operations",
      leaders: ["COO / VP Operations", "Director of operations"], frontline: ["Ops analyst who builds the weekly deck", "Market operations managers"],
      q: [
        "Which three numbers do you look at first on Monday, and which one do you trust least?",
        "Between roster file and billed visit, where do you believe we lose the most members today?",
        "What changed with the scheduling-system cutover, and which team absorbed the extra work?",
        "Which health-plan contract terms (visit targets, HEDIS/Star gap closure, turnaround times) carry penalties or bonuses this year?",
        "If one cross-team handoff were fixed in 60 days, which would you pick and why?",
        "Which improvement efforts were tried here before and stalled? What stopped them?",
        "How do growth targets turn into staffing plans for agents and clinicians?",
        "Which decisions are made from spreadsheets today that you wish came from one governed number?",
        "Who has to approve a change that touches member communications or PHI?",
      ],
      listen: ["Numbers that disagree across teams", "Decisions waiting on a person rather than data", "Repeat escalations from the same plan", "Initiatives with no owner after launch"],
      data: ["Weekly ops deck, last 12 weeks", "Plan scorecards: visit targets and gap-closure rates", "Headcount by team and market", "Open initiative list with owners and status"],
      shadow: ["Sit in the Monday ops review: time spent reconciling numbers vs deciding", "Count reports pulled by hand before the meeting", "Log every decision deferred for missing data"],
    },
    {
      id: "outreach", name: "Outreach & call center", oppDept: "Call center", owner: "Call center manager",
      leaders: ["Call center manager", "Workforce manager (WFM)"], frontline: ["Outreach agents, English and bilingual", "QA and call monitoring lead"],
      q: [
        "Walk me through one call from dial to disposition. Which screens do you touch, in what order?",
        "How many attempts, across which channels, before a member is marked unreachable?",
        "When an English-only agent reaches a Spanish-preferred member, what happens next and how long until the callback?",
        "Since the scheduling-system change, which steps were added to after-call work?",
        "Which disposition codes are ambiguous or used as a catch-all?",
        "How is the AHT target set, and what happens when an agent trades handle time for a scheduled visit?",
        "What share of inbound calls are members returning a missed outbound call, and do they reach the same queue?",
        "What do you keep in a personal note or spreadsheet because the CRM does not hold it?",
        "How fast does a do-not-call request reach the dialer, and who confirms it?",
        "When were the call scripts last updated, and who approves changes?",
      ],
      listen: ["Swivel-chair entry between dialer, CRM and scheduler", "Callbacks owned by nobody", "Disposition codes that hide the real reason", "Agents working around language routing"],
      data: ["ACD interval report: AHT, ACW, ASA, abandon rate by week", "Disposition counts by agent and code", "Callback queue with created and closed timestamps", "Dialer attempt counts per member (counts only, no identifiers)", "QA scorecards by agent"],
      shadow: ["Sit with two agents, one bilingual, for an hour each", "Time ACW on 10 calls with a stopwatch", "Count screens and re-typed fields per scheduled visit", "Note every callback created and who owns it"],
    },
    {
      id: "scheduling", name: "Scheduling", oppDept: "Scheduling", owner: "Scheduling lead",
      leaders: ["Scheduling lead", "Market operations manager"], frontline: ["Schedulers and coordinators", "Confirmation call team"],
      q: [
        "What % of scheduled visits are rescheduled at least once, and who owns the reschedule?",
        "How far out is the first open in-home slot in each market today?",
        "Which reminders go out (one-way SMS, two-way SMS, live call), when, and who decides?",
        "When a member cancels the same day, what happens to that clinician slot?",
        "Are slots offered first-available, or by clinician route and geography?",
        "What do you check before booking: eligibility, a visit already done this year, language, caregiver?",
        "How do you find out a member already had an annual wellness visit with their PCP?",
        "Which fields do you key into both the scheduling system and the CRM?",
        "How do clinician calendar changes reach you, and how late?",
      ],
      listen: ["Long lead times in high no-show markets", "Unconfirmed appointments left in place until the day", "Booking without route logic", "Double entry since the cutover"],
      data: ["Appointment export: lead days, reminder type, confirmation, outcome", "Reschedule and cancel reason codes", "Clinician availability templates by market", "Same-day cancellation log with refill time"],
      shadow: ["Watch 10 bookings end to end", "Count fields entered twice", "Note how slots are chosen: member asks or scheduler offers", "Time from a cancellation to the slot being refilled"],
    },
    {
      id: "clinical", name: "Clinical services", oppDept: "Clinical", owner: "Clinical director",
      leaders: ["Clinical director", "Coding & QA lead"], frontline: ["NPs and RNs (in-home and telehealth)", "Chart QA nurse reviewers"],
      q: [
        "How long does documentation take after an in-home assessment, and where does that time go?",
        "What are the five most common reasons a chart fails QA on first pass?",
        "How long does a bounced chart wait for correction, and how does that delay billing?",
        "What onboarding do new clinicians get on templates and required HRA fields?",
        "Which HEDIS/Star gap closures does each plan expect from each visit type?",
        "How are urgent clinical findings from outreach calls escalated and documented?",
        "Where do you re-enter information that outreach or scheduling already captured?",
        "Which parts of the note could a draft help with, and which must stay clinician-authored?",
        "How are SDOH needs captured during a visit and referred?",
      ],
      listen: ["Template gaps that new clinicians hit", "QA rework concentrated in a few fields", "Chart lag above 24 hours", "Unclear boundaries for AI on clinical content"],
      data: ["Chart QA results by clinician, reason code and week", "Chart lag: visit to submission, in hours", "Documentation minutes per visit", "Gap-closure rates by measure and plan"],
      shadow: ["Observe one telehealth visit, or ride along on an in-home visit with consent", "Watch three QA reviews and count bounce reasons", "Time chart completion after the visit ends"],
    },
    {
      id: "provider", name: "Provider management", oppDept: "Provider management", owner: "Provider operations manager",
      leaders: ["Provider operations manager", "Credentialing manager"], frontline: ["Clinician dispatch and calendar staff", "Clinicians in high-drive markets"],
      q: [
        "How is clinician capacity planned per market each month?",
        "What is the target for completed visits per clinician-day, and what keeps clinicians below it?",
        "How much of a clinician day is drive time, and is booking route-aware?",
        "Where is utilization near 100%, and what happens to lead times there?",
        "How are licenses and credentials tracked, and when did a lapse last take someone off the schedule?",
        "How long from offer to a new clinician's first independent visit?",
        "Who decides telehealth vs in-home for a member, and on what basis?",
        "Who decides to add a clinician in a market, and with what data?",
      ],
      listen: ["Utilization near ceiling with long lead times", "Drive time eating visit slots", "Credential tracking in a spreadsheet", "Hiring decisions made after the backlog appears"],
      data: ["Clinician roster: modality, tenure, days worked", "Scheduled vs capacity slots per clinician", "Drive and visit minutes per day", "Credential and license expiration list"],
      shadow: ["Watch the next-day route build for one market", "Count manual calendar edits", "Check how same-day cancellations are backfilled"],
    },
    {
      id: "finance", name: "Finance & billing", oppDept: "Finance", owner: "Finance ops manager",
      leaders: ["Controller / finance ops manager", "Revenue cycle lead"], frontline: ["Billing specialists", "Reconciliation analyst"],
      q: [
        "How do you reconcile plan eligibility rosters against our member file, and how long does it take each month?",
        "How many outreach attempts last month went to members already termed on the latest roster?",
        "From completed visit to submitted encounter, what is the cycle time and where does it wait?",
        "Which contracts pay per visit and which per gap closed, and how is that tracked?",
        "What % of submitted encounters do plans reject, and for which reasons?",
        "Which reports do you rebuild by hand every month?",
        "How do you know revenue per completed visit by plan and market?",
        "What would you need to see to trust an hours-saved or dollar-impact claim?",
      ],
      listen: ["Excel reconciliations", "Late roster changes reaching outreach", "Rejected encounters caused upstream", "Impact claims that nobody validated"],
      data: ["Monthly roster files: record counts and field list only", "Reconciliation workbook and exception log", "Encounter submission and rejection log", "Revenue per visit by plan"],
      shadow: ["Walk through one month-end reconciliation", "Count manual lookups per exception", "List every file exchanged with plans and who sends it"],
    },
    {
      id: "cs", name: "Customer success (health plans)", oppDept: "Customer success", owner: "Customer success lead",
      leaders: ["VP customer success", "Account managers"], frontline: ["Implementation and onboarding specialist", "Plan reporting analyst"],
      q: [
        "What do plans raise most often in quarterly business reviews?",
        "How long does a new plan launch take from signature to first completed visit?",
        "Where do eligibility and data-feed problems surface during onboarding, and how late?",
        "Which numbers in plan reports differ from internal ops numbers, and why?",
        "How many hours a month go into building plan performance reports?",
        "What do plans expect on member experience: call frequency, language access, opt-outs?",
        "Which plan commitments are at risk this quarter?",
        "Who owns each step of a plan launch, and where is that written down?",
      ],
      listen: ["Launch tasks living in email", "Plan numbers that do not match ops numbers", "Member complaints about call volume", "Data-feed defects found late"],
      data: ["Plan launch timelines, last four launches", "Monthly plan reports and their source exports", "Complaint and escalation log", "Contract SLAs and reporting requirements"],
      shadow: ["Sit in a QBR prep session", "Trace one plan report from export to email", "List onboarding handoffs by team"],
    },
    {
      id: "eng", name: "Engineering & data (partner)", oppDept: "Engineering & data", owner: "Engineering manager",
      leaders: ["Engineering manager", "Data / analytics lead"], frontline: ["Integration engineer", "Security and privacy officer"],
      q: [
        "Which systems are the source of truth for members, appointments, calls and charts?",
        "What APIs or scheduled exports exist for the scheduling system, dialer and CRM?",
        "What is the approved path to use an LLM with PHI: which vendors have a BAA, and what must be logged?",
        "What can ops build on low-code tools (n8n, Zapier, Power BI) without engineering review, and where is the line?",
        "How are changes to production workflows tested and rolled back?",
        "What on this quarter's roadmap touches scheduling or the call center?",
        "Which data quality issues do you already know about: duplicate members, ID mismatches, timestamps?",
        "How do you want requests from ops: a problem statement, a spec, or a working prototype?",
        "What monitoring exists for automated jobs, and who gets paged?",
      ],
      listen: ["Unclear PHI rules for AI tools", "Integration work queued behind the roadmap", "Shadow IT already running", "Automations without audit logs"],
      data: ["System inventory and data dictionary", "API docs for scheduling and dialer", "BAA vendor list and AI acceptable-use policy", "Known data quality issue log"],
      shadow: ["Join one sprint planning or triage session", "Review an existing automation's runbook", "Walk the data lineage for the weekly funnel numbers"],
    },
  ];
  const deptById = (id) => DEPTS.find((d) => d.id === id) || DEPTS[0];

  const KPI_BY_TYPE = {
    "Delay": "Cycle time (days)", "Rework": "First-pass rate", "Handoff": "Handoff wait time (hrs)", "Manual entry": "Minutes per record",
    "Data quality": "Exception rate", "Compliance risk": "Policy exceptions per week", "Tooling": "Time per task (min)",
  };

  const EXAMPLES = [
    { id: "EX-1", example: true, dept: "scheduling", who: "Scheduling coordinator (frontline)", date: "2026-10-13", type: "Manual entry", freq: "Every call or visit", hours: 18,
      title: "Remove double entry between scheduler and CRM",
      pain: "Every booked visit is keyed twice since the cutover: once in the new scheduling system and again on the CRM disposition screen.",
      quote: "I type the same address and time twice, and if I miss one the clinician shows up to the wrong slot." },
    { id: "EX-2", example: true, dept: "outreach", who: "Bilingual outreach agent", date: "2026-10-13", type: "Handoff", freq: "Daily", hours: 6,
      title: "Own the Spanish-language callback queue",
      pain: "Spanish-preferred members reached by English-only agents go into a shared callback inbox that nobody owns.",
      quote: "Some of those callbacks sit for a week. By then the member stops picking up." },
    { id: "EX-3", example: true, dept: "clinical", who: "Chart QA nurse reviewer", date: "2026-10-14", type: "Rework", freq: "Daily", hours: 10,
      title: "Stop chart QA bounces on required HRA fields",
      pain: "New clinicians miss required HRA fields; charts bounce back and wait 3 to 5 days for correction before billing.",
      quote: "Half of my bounces are the same four fields." },
    { id: "EX-4", example: true, dept: "finance", who: "Reconciliation analyst", date: "2026-10-14", type: "Data quality", freq: "Monthly", hours: 7,
      title: "Automate roster reconciliation exceptions",
      pain: "Monthly roster reconciliation against three plan eligibility files is done by hand in Excel; termed members still get outreach calls.",
      quote: "I find termed members on the outreach list every single month." },
    { id: "EX-5", example: true, dept: "provider", who: "Market operations manager", date: "2026-10-15", type: "Delay", freq: "Daily", hours: 12,
      title: "Book in-home visits by route cluster",
      pain: "Clinician days are booked first-come; drive time between in-home visits is close to an hour in the widest market.",
      quote: "We lose a visit a day per clinician to the road." },
    { id: "EX-6", example: true, dept: "cs", who: "Account manager, health plans", date: "2026-10-16", type: "Manual entry", freq: "Monthly", hours: 5,
      title: "Generate plan performance reports from one dataset",
      pain: "Monthly plan reports are stitched together from three exports, and the numbers rarely match the ops weekly deck.",
      quote: "The plan asks why my show rate is different from the one ops sent them." },
  ];

  // ---------- CSS ----------
  const CSS = `
  .disc-tabs { overflow-x: auto; max-width: 100%; }
  .disc-tabs .seg { flex-wrap: wrap; }
  .disc-guide { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 18px; }
  .disc-q { margin: 0; padding-left: 22px; display: grid; gap: 8px; font-size: var(--fs-sm); }
  .disc-q li::marker { font-family: var(--font-mono); color: var(--ink-3); font-size: var(--fs-xs); }
  .disc-who { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .disc-who ul, .disc-list { margin: 0; padding-left: 18px; font-size: var(--fs-sm); display: grid; gap: 3px; }
  .disc-data li { font-family: var(--font-mono); font-size: 0.78rem; }
  .disc-shadow { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 18px; }
  .disc-tally { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .disc-count { border: 1px solid var(--line); border-radius: var(--r-md); padding: 10px; display: flex; flex-direction: column; gap: 6px; min-width: 0; background: var(--surface); }
  .disc-count-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .disc-count b { font-family: var(--font-display); font-size: 1.6rem; font-variant-numeric: tabular-nums; line-height: 1; }
  .disc-count .btn { padding: 2px 9px; min-width: 30px; }
  .disc-checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .disc-checks label { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 8px; font-size: var(--fs-sm); cursor: pointer; align-items: start; }
  .disc-checks input { margin: 3px 0 0; }
  .disc-capture { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); gap: 18px; align-items: start; }
  .disc-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .disc-form .disc-full { grid-column: 1 / -1; }
  .disc-err { color: var(--critical-ink); font-size: var(--fs-xs); min-height: 1em; }
  .disc-notes { display: grid; gap: 10px; max-height: 760px; overflow-y: auto; padding-right: 2px; }
  .disc-note { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: var(--r-md); padding: 12px; display: flex; flex-direction: column; gap: 6px; background: var(--surface); min-width: 0; }
  .disc-note.is-example { border-left-color: var(--line-strong); }
  .disc-note.is-promoted { border-left-color: var(--good); }
  .disc-note-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: var(--fs-xs); color: var(--ink-3); }
  .disc-note p { font-size: var(--fs-sm); }
  .disc-quote { font-size: var(--fs-sm); color: var(--ink-2); font-style: italic; border-left: 2px solid var(--line-strong); padding-left: 10px; }
  .disc-note-acts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .disc-link { font-weight: 600; font-size: var(--fs-sm); text-decoration: none; }
  .disc-link:hover { text-decoration: underline; }
  .disc-synth { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .disc-themes { white-space: pre-wrap; font-size: var(--fs-sm); line-height: 1.6; background: var(--surface-2); border-radius: var(--r-md); padding: 14px; margin: 0; font-family: var(--font-body); color: var(--ink); }
  @media (max-width: 1000px) {
    .disc-guide, .disc-shadow, .disc-capture, .disc-synth { grid-template-columns: minmax(0, 1fr); }
    .disc-notes { max-height: none; overflow: visible; }
  }
  @media (max-width: 560px) {
    .disc-form, .disc-who { grid-template-columns: minmax(0, 1fr); }
    .disc-tally { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }`;

  let oppListener = null;

  // ---------- render ----------
  function render(root, ctx) {
    UI.style("discovery", CSS);
    const F = UI.fmt;
    const reg = (id) => OPS.modules().some((m) => m.id === id);
    const titleOf = (id) => { const m = OPS.modules().find((x) => x.id === id); return m ? m.title : id; };

    let dept = UI.store.get(KEY_DEPT, "outreach");
    if (!DEPTS.some((d) => d.id === dept)) dept = "outreach";
    let notes = UI.store.get(KEY_NOTES, null);
    if (!Array.isArray(notes)) notes = EXAMPLES.map((e) => Object.assign({}, e));
    let shadow = UI.store.get(KEY_SHADOW, {});
    if (!shadow || typeof shadow !== "object") shadow = {};
    let listFilter = "all";
    let armed = null; // note id armed for removal
    const saveNotes = () => UI.store.set(KEY_NOTES, notes);
    const today = new Date().toISOString().slice(0, 10);

    root.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div><h2>Department interview guides</h2><div class="panel-sub">Who to meet, what to ask, what to listen for, and what data to request. Built for the first 30 days.</div></div>
          <button class="btn sm" type="button" id="disc-copy-guide">${UI.icon("copy")}Copy this guide</button>
        </div>
        <div class="disc-tabs">${UI.seg("disc-dept", DEPTS.map((d) => ({ value: d.id, label: d.name })), dept)}</div>
        <div id="disc-guide"></div>
        <div class="presenter-note">I would run these interviews in my first two weeks, a leader and a frontline person in every department. The questions are specific on purpose: they ask for a number or a walkthrough, so the answer can be checked against the data.</div>
      </div>

      <div class="panel" id="disc-shadow-panel"></div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>Interview capture</h2><div class="panel-sub">Log each pain point as it is heard. Promote the ones worth solving into the shared opportunity pipeline.</div></div>
          <div class="row" id="disc-capture-tools"></div>
        </div>
        <div class="disc-capture">
          <form class="panel inset" id="disc-form" novalidate>
            <h3>New pain point</h3>
            <div class="disc-form">
              ${UI.select("disc-f-dept", DEPTS.map((d) => ({ value: d.id, label: d.name })), dept, "Department")}
              <label class="field" for="disc-f-who"><span>Person / role</span><input class="input" id="disc-f-who" placeholder="Role, not a member name" autocomplete="off"></label>
              <label class="field" for="disc-f-date"><span>Date</span><input class="input" type="date" id="disc-f-date" value="${today}"></label>
              ${UI.select("disc-f-type", TYPES.map((t) => ({ value: t, label: t })), "Manual entry", "Type")}
              <label class="field disc-full" for="disc-f-pain"><span>Pain point</span><textarea class="textarea" id="disc-f-pain" rows="3" placeholder="What happens, how often, and who it affects"></textarea></label>
              ${UI.select("disc-f-freq", FREQS.map((t) => ({ value: t, label: t })), "Daily", "Frequency")}
              <label class="field" for="disc-f-hours"><span>Est. hours per week (team)</span><input class="input" type="number" min="0" max="400" step="0.5" id="disc-f-hours" value="4"></label>
              <label class="field disc-full" for="disc-f-quote"><span>Quote (their words)</span><input class="input" id="disc-f-quote" autocomplete="off"></label>
            </div>
            <p class="xs muted">No member names or identifiers in notes: describe the pattern, not the person.</p>
            <div class="disc-err" id="disc-err" aria-live="polite"></div>
            <div class="row"><button class="btn primary" type="submit">${UI.icon("plus")}Add pain point</button></div>
          </form>
          <div class="stack">
            <div class="row between">
              <span class="small muted" id="disc-count"></span>
              <label class="row" for="disc-filter" style="gap:6px"><span class="xs muted">Show</span><select class="select" id="disc-filter" style="width:auto;max-width:220px">${[{ value: "all", label: "All departments" }].concat(DEPTS.map((d) => ({ value: d.id, label: d.name }))).map((o) => `<option value="${o.value}">${UI.esc(o.label)}</option>`).join("")}</select></label>
            </div>
            <div class="disc-notes" id="disc-notes" aria-live="polite"></div>
          </div>
        </div>
        <div class="presenter-note">Watch what happens when I promote a pain point: it becomes a scored opportunity in the pipeline with its source marked as discovery, so nothing I hear on the floor gets lost in a notebook.</div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>Synthesis so far</h2><div class="panel-sub">Recomputed from the capture log every time a note is added, promoted or removed.</div></div>
          <button class="btn sm" type="button" id="disc-copy-themes">${UI.icon("copy")}Copy themes</button>
        </div>
        <div class="grid g-4" id="disc-kpis"></div>
        <div class="disc-synth">
          <div class="stack"><h3>Pain points by type</h3><div class="chart-box"><canvas id="disc-c-count" aria-label="Pain points by type"></canvas></div></div>
          <div class="stack"><h3>Estimated hours per week by type</h3><div class="chart-box"><canvas id="disc-c-hours" aria-label="Estimated hours per week by type"></canvas></div></div>
        </div>
        <div class="disc-synth">
          <div class="stack"><h3>By department</h3><div id="disc-dept-table"></div></div>
          <div class="stack"><h3>Themes so far</h3><pre class="disc-themes" id="disc-themes"></pre></div>
        </div>
        <div class="presenter-note">After two weeks this summary is my Day-30 readout draft: the biggest themes by hours, who said it in their own words, and which departments I still have not heard from.</div>
      </div>`;

    // ---------- guide ----------
    function drawGuide() {
      const d = deptById(dept);
      root.querySelector("#disc-guide").innerHTML = `
        <div class="disc-guide">
          <div class="stack">
            <div class="label">Sharp questions · ${d.q.length}</div>
            <ol class="disc-q">${d.q.map((x) => `<li>${UI.esc(x)}</li>`).join("")}</ol>
          </div>
          <div class="stack" style="gap:14px">
            <div class="stack" style="gap:6px"><div class="label">Who to meet</div>
              <div class="disc-who">
                <div><div class="xs muted" style="margin-bottom:4px">Leaders</div><ul>${d.leaders.map((x) => `<li>${UI.esc(x)}</li>`).join("")}</ul></div>
                <div><div class="xs muted" style="margin-bottom:4px">Frontline</div><ul>${d.frontline.map((x) => `<li>${UI.esc(x)}</li>`).join("")}</ul></div>
              </div>
            </div>
            <div class="stack" style="gap:6px"><div class="label">What I'm listening for</div><ul class="disc-list">${d.listen.map((x) => `<li>${UI.esc(x)}</li>`).join("")}</ul></div>
            <div class="stack" style="gap:6px"><div class="label">Data to request</div><ul class="disc-list disc-data">${d.data.map((x) => `<li>${UI.esc(x)}</li>`).join("")}</ul></div>
          </div>
        </div>`;
    }

    function shadowState(id) {
      const s = shadow[id] || {};
      return { counts: Object.assign({}, s.counts || {}), checks: Object.assign({}, s.checks || {}) };
    }
    function drawShadow() {
      const d = deptById(dept);
      const s = shadowState(d.id);
      const total = TALLY.reduce((a, t) => a + (s.counts[t.id] || 0), 0);
      root.querySelector("#disc-shadow-panel").innerHTML = `
        <div class="panel-head">
          <div><h2>2-hour shadowing checklist · ${UI.esc(d.name)}</h2><div class="panel-sub">Tally what you see, not what people describe. ${total ? `${total} observations logged for this department.` : "Tap + each time you see one."}</div></div>
          <button class="btn sm ghost" type="button" id="disc-shadow-reset">${total || Object.keys(s.checks).length ? "Clear tally" : ""}</button>
        </div>
        <div class="disc-shadow">
          <div class="disc-tally">${TALLY.map((t) => `<div class="disc-count">
            <div class="small" style="font-weight:600">${UI.esc(t.label)}</div>
            <div class="xs muted">${UI.esc(t.hint)}</div>
            <div class="disc-count-top"><b id="disc-n-${t.id}">${s.counts[t.id] || 0}</b>
              <span class="row" style="gap:4px"><button class="btn sm" type="button" data-tally="${t.id}" data-delta="-1" aria-label="Remove one ${UI.esc(t.label)}">−</button><button class="btn sm" type="button" data-tally="${t.id}" data-delta="1" aria-label="Add one ${UI.esc(t.label)}">+</button></span>
            </div>
          </div>`).join("")}</div>
          <div class="stack" style="gap:8px">
            <div class="label">Also do while shadowing</div>
            <ul class="disc-checks">${d.shadow.map((x, i) => `<li><label for="disc-sc-${i}"><input type="checkbox" id="disc-sc-${i}" data-scheck="${i}"${s.checks[i] ? " checked" : ""}><span>${UI.esc(x)}</span></label></li>`).join("")}</ul>
          </div>
        </div>`;
      const rb = root.querySelector("#disc-shadow-reset");
      if (!rb.textContent.trim()) rb.style.display = "none";
    }

    function guideMarkdown() {
      const d = deptById(dept);
      const L = [`# Discovery guide: ${d.name}`, "", `**Leaders:** ${d.leaders.join("; ")}`, `**Frontline:** ${d.frontline.join("; ")}`, "", "## Questions"];
      d.q.forEach((x, i) => L.push(`${i + 1}. ${x}`));
      L.push("", "## Listening for"); d.listen.forEach((x) => L.push(`- ${x}`));
      L.push("", "## Data to request"); d.data.forEach((x) => L.push(`- ${x}`));
      L.push("", "## 2-hour shadowing"); TALLY.forEach((t) => L.push(`- Count: ${t.label} (${t.hint})`)); d.shadow.forEach((x) => L.push(`- ${x}`));
      return L.join("\n");
    }

    // ---------- notes ----------
    const oppFor = (n) => (n.oppId ? OPS.opps.get(n.oppId) : null);
    function drawNotes() {
      const list = notes.filter((n) => listFilter === "all" || n.dept === listFilter);
      const ex = notes.filter((n) => n.example).length;
      root.querySelector("#disc-count").textContent = `${list.length} pain point${list.length === 1 ? "" : "s"}${listFilter === "all" ? "" : " in " + deptById(listFilter).name}${ex ? ` · ${ex} example${ex === 1 ? "" : "s"}` : ""}`;
      const missing = EXAMPLES.filter((e) => !notes.some((n) => n.id === e.id)).length;
      root.querySelector("#disc-capture-tools").innerHTML = missing ? `<button class="btn sm ghost" type="button" id="disc-restore">Restore ${missing} example${missing === 1 ? "" : "s"}</button>` : "";
      root.querySelector("#disc-notes").innerHTML = list.length ? list.map((n) => {
        const d = deptById(n.dept);
        const opp = oppFor(n);
        const canNav = reg("pipeline");
        return `<article class="disc-note${n.example ? " is-example" : ""}${opp ? " is-promoted" : ""}">
          <div class="disc-note-meta">
            ${n.example ? UI.pill("neutral", "Example") : ""}
            ${UI.pill("accent", n.type)}
            <span>${UI.esc(d.name)}</span><span>·</span><span>${UI.esc(n.who || "Role not set")}</span><span>·</span><span>${UI.esc(n.date ? F.date(n.date) : "")}</span>
          </div>
          <p>${UI.esc(n.pain)}</p>
          ${n.quote ? `<div class="disc-quote">“${UI.esc(n.quote)}”</div>` : ""}
          <div class="disc-note-meta"><span>${UI.esc(n.freq)}</span><span>·</span><span>~${F.dec(n.hours, n.hours % 1 ? 1 : 0)} hrs/week</span></div>
          <div class="disc-note-acts">
            ${opp ? `${UI.pill("good", "Promoted · " + opp.id)}${canNav ? `<a class="disc-link" href="#pipeline" data-opp="${UI.esc(opp.id)}">View in ${UI.esc(titleOf("pipeline"))} →</a>` : ""}`
              : `<button class="btn sm primary" type="button" data-promote="${UI.esc(n.id)}">${UI.icon("arrow")}Promote to opportunity</button>`}
            <button class="btn sm ${armed === n.id ? "" : "ghost"}" type="button" data-remove="${UI.esc(n.id)}">${armed === n.id ? "Confirm remove" : "Remove"}</button>
          </div>
        </article>`;
      }).join("") : `<div class="empty">No pain points logged${listFilter === "all" ? "" : " for this department"} yet. Add one with the form.</div>`;
    }

    // ---------- synthesis ----------
    let chCount = null, chHours = null;
    function stats() {
      const byType = TYPES.map((t) => {
        const l = notes.filter((n) => n.type === t);
        return { type: t, n: l.length, hours: l.reduce((s, n) => s + (+n.hours || 0), 0), notes: l };
      });
      const byDept = DEPTS.map((d) => {
        const l = notes.filter((n) => n.dept === d.id);
        const top = TYPES.map((t) => ({ t, h: l.filter((n) => n.type === t).reduce((s, n) => s + (+n.hours || 0), 0), c: l.filter((n) => n.type === t).length })).filter((x) => x.c).sort((a, b) => b.h - a.h)[0];
        return { d, n: l.length, hours: l.reduce((s, n) => s + (+n.hours || 0), 0), top: top ? top.t : null, promoted: l.filter((n) => oppFor(n)).length };
      });
      return { byType, byDept, total: notes.length, hours: notes.reduce((s, n) => s + (+n.hours || 0), 0), promoted: notes.filter((n) => oppFor(n)).length };
    }
    function themesText(S) {
      if (!S.total) return "No pain points captured yet. Start with the Outreach & call center and Scheduling guides; that is where most member-facing time is spent.";
      const covered = S.byDept.filter((x) => x.n);
      const ranked = S.byType.filter((t) => t.n).sort((a, b) => b.hours - a.hours || b.n - a.n);
      const L = [];
      L.push(`Themes so far: ${S.total} pain point${S.total === 1 ? "" : "s"} from ${covered.length} of ${DEPTS.length} departments, about ${F.num(S.hours)} team hours a week.`);
      L.push("");
      ranked.slice(0, 3).forEach((t, i) => {
        const depts = Array.from(new Set(t.notes.map((n) => deptById(n.dept).name)));
        const q = t.notes.find((n) => n.quote);
        L.push(`${i + 1}. ${t.type}: ${t.n} note${t.n === 1 ? "" : "s"}, ~${F.num(t.hours)} hrs/week (${depts.join(", ")}).${q ? ` "${q.quote}"` : ""}`);
      });
      const cross = S.byType.filter((t) => t.type === "Handoff" || t.type === "Manual entry").reduce((s, t) => s + t.n, 0);
      if (cross) {
        L.push("");
        L.push(`Cross-team pattern: ${cross} of ${S.total} notes involve a handoff or re-keying between systems. Map those workflows end to end before automating any single step.`);
      }
      const gaps = S.byDept.filter((x) => !x.n).map((x) => x.d.name);
      if (gaps.length) { L.push(""); L.push(`Not heard from yet: ${gaps.join(", ")}.`); }
      const topDept = S.byDept.slice().sort((a, b) => b.hours - a.hours)[0];
      const shadowTotals = TALLY.map((t) => ({ t, n: Object.values(shadow).reduce((s, x) => s + ((x && x.counts && x.counts[t.id]) || 0), 0) })).filter((x) => x.n);
      if (shadowTotals.length) { L.push(""); L.push(`Shadowing tallies: ${shadowTotals.map((x) => `${x.n} ${x.t.label.toLowerCase()}`).join(", ")}.`); }
      L.push("");
      L.push(`Next: map the ${topDept.d.name.toLowerCase()} workflow with the team, and request "${topDept.d.data[0]}" to size it. ${S.promoted} of ${S.total} promoted to the pipeline so far.`);
      return L.join("\n");
    }
    function drawSynth() {
      const S = stats();
      const covered = S.byDept.filter((x) => x.n).length;
      root.querySelector("#disc-kpis").innerHTML = [
        UI.kpi({ label: "Pain points logged", value: F.num(S.total), foot: `${notes.filter((n) => n.example).length} examples` }),
        UI.kpi({ label: "Departments covered", value: covered + " / " + DEPTS.length, foot: covered < DEPTS.length ? `${DEPTS.length - covered} still to interview` : "all departments heard" }),
        UI.kpi({ label: "Team hours / week", value: F.num(S.hours), foot: "estimated by the people doing the work" }),
        UI.kpi({ label: "Promoted to pipeline", value: F.num(S.promoted), foot: S.total ? F.pct(S.promoted / S.total, 0) + " of pain points" : "" }),
      ].join("");
      root.querySelector("#disc-dept-table").innerHTML = UI.table([
        { key: "name", label: "Department", fmt: (v, r) => UI.esc(v) + (r.n ? "" : ` <span class="xs muted">· not yet interviewed</span>`) },
        { key: "n", label: "Notes", num: true },
        { key: "hours", label: "Hrs / wk", num: true, fmt: (v) => F.num(v) },
        { key: "top", label: "Top type", fmt: (v) => (v ? UI.esc(v) : `<span class="muted">—</span>`) },
        { key: "promoted", label: "Promoted", num: true },
      ], S.byDept.map((x) => ({ name: x.d.name, n: x.n, hours: x.hours, top: x.top, promoted: x.promoted })));
      root.querySelector("#disc-themes").textContent = themesText(S);

      const labels = TYPES;
      const grid = UI.cssVar("--chart-grid");
      const common = (fmtTick, max) => ({
        indexAxis: "y",
        interaction: { mode: "nearest", axis: "y", intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => " " + fmtTick(c.parsed.x) } } },
        scales: { y: { grid: { display: false }, ticks: { autoSkip: false } }, x: { beginAtZero: true, suggestedMax: max, grid: { color: grid }, ticks: { precision: 0 } } },
      });
      if (chCount) { try { chCount.destroy(); } catch (e) { /* ignore */ } }
      if (chHours) { try { chHours.destroy(); } catch (e) { /* ignore */ } }
      chCount = UI.chart("disc-c-count", { type: "bar", data: { labels, datasets: [{ label: "Pain points", data: S.byType.map((t) => t.n), backgroundColor: UI.series(0), borderRadius: 4, maxBarThickness: 22, borderSkipped: "start" }] }, options: common((v) => v + " pain point" + (v === 1 ? "" : "s"), Math.max(2, Math.max.apply(null, S.byType.map((t) => t.n)) + 1)) });
      chHours = UI.chart("disc-c-hours", { type: "bar", data: { labels, datasets: [{ label: "Hours per week", data: S.byType.map((t) => t.hours), backgroundColor: UI.series(0), borderRadius: 4, maxBarThickness: 22, borderSkipped: "start" }] }, options: common((v) => F.num(v) + " hrs/week", 5) });
    }

    function promote(note) {
      const d = deptById(note.dept);
      const hrs = +note.hours || 0;
      const impact = hrs >= 15 ? 4 : hrs >= 6 ? 3 : 2;
      const rec = OPS.opps.save({
        title: note.title || (note.type + ": " + (note.pain.length > 64 ? note.pain.slice(0, 61).replace(/\s+\S*$/, "") + "…" : note.pain)),
        dept: d.oppDept,
        stage: "Discovery",
        problem: note.pain + (note.quote ? ` Frontline: "${note.quote}"` : ""),
        solution: "To be designed with the team after mapping the current workflow.",
        kpi: KPI_BY_TYPE[note.type] || "Hours per week",
        impact, confidence: 2, effort: 3,
        risk: note.type === "Compliance risk" ? "High" : note.type === "Data quality" ? "Medium" : "Low",
        hoursSavedPerMonth: Math.round(hrs * 4.33 * 0.5),
        revenueImpactAnnual: 0,
        owner: d.owner,
        tools: [],
        source: "discovery",
        discoveryNote: note.id,
      });
      note.oppId = rec.id;
      saveNotes();
      UI.toast(`Promoted to ${rec.id} in the pipeline (assumes half of ${F.num(hrs)} hrs/week is recoverable)`);
      return rec;
    }

    drawGuide(); drawShadow(); drawNotes(); drawSynth();

    // ---------- events ----------
    UI.wireSeg(root, "disc-dept", (v) => {
      dept = v;
      UI.store.set(KEY_DEPT, dept);
      const sel = root.querySelector("#disc-f-dept");
      if (sel) sel.value = dept;
      drawGuide(); drawShadow();
    });
    root.querySelector("#disc-copy-guide").addEventListener("click", () => UI.copy(guideMarkdown(), "Interview guide copied as Markdown"));
    root.querySelector("#disc-copy-themes").addEventListener("click", () => UI.copy(root.querySelector("#disc-themes").textContent, "Themes copied"));

    UI.on(root, "click", "[data-tally]", (e, el) => {
      const s = shadowState(dept);
      const id = el.dataset.tally;
      s.counts[id] = Math.max(0, (s.counts[id] || 0) + (+el.dataset.delta));
      shadow[dept] = s;
      UI.store.set(KEY_SHADOW, shadow);
      const n = root.querySelector("#disc-n-" + id);
      if (n) n.textContent = s.counts[id];
      const total = TALLY.reduce((a, t) => a + (s.counts[t.id] || 0), 0);
      const sub = root.querySelector("#disc-shadow-panel .panel-sub");
      if (sub) sub.textContent = `Tally what you see, not what people describe. ${total ? `${total} observations logged for this department.` : "Tap + each time you see one."}`;
      const rb = root.querySelector("#disc-shadow-reset");
      if (rb) { rb.textContent = "Clear tally"; rb.style.display = ""; }
      root.querySelector("#disc-themes").textContent = themesText(stats());
    });
    UI.on(root, "change", "[data-scheck]", (e, el) => {
      const s = shadowState(dept);
      if (el.checked) s.checks[el.dataset.scheck] = true; else delete s.checks[el.dataset.scheck];
      shadow[dept] = s;
      UI.store.set(KEY_SHADOW, shadow);
    });
    UI.on(root, "click", "#disc-shadow-reset", () => {
      delete shadow[dept];
      UI.store.set(KEY_SHADOW, shadow);
      drawShadow();
      root.querySelector("#disc-themes").textContent = themesText(stats());
    });

    root.querySelector("#disc-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const val = (id) => root.querySelector("#" + id).value.trim();
      const pain = val("disc-f-pain");
      const err = root.querySelector("#disc-err");
      if (pain.length < 8) { err.textContent = "Describe the pain point in a sentence before adding it."; root.querySelector("#disc-f-pain").focus(); return; }
      const hours = Math.max(0, Math.min(400, parseFloat(val("disc-f-hours")) || 0));
      err.textContent = "";
      const n = {
        id: "DN-" + Date.now().toString(36),
        dept: val("disc-f-dept"), who: val("disc-f-who"), date: val("disc-f-date") || today,
        type: val("disc-f-type"), freq: val("disc-f-freq"), hours, pain, quote: val("disc-f-quote"),
      };
      notes.unshift(n);
      saveNotes();
      root.querySelector("#disc-f-pain").value = "";
      root.querySelector("#disc-f-quote").value = "";
      root.querySelector("#disc-f-who").value = "";
      listFilter = "all";
      root.querySelector("#disc-filter").value = "all";
      drawNotes(); drawSynth();
      UI.toast("Pain point added to the log");
    });
    root.querySelector("#disc-filter").addEventListener("change", (e) => { listFilter = e.target.value; drawNotes(); });

    UI.on(root, "click", "[data-promote]", (e, el) => {
      const n = notes.find((x) => x.id === el.dataset.promote);
      if (!n || oppFor(n)) return;
      promote(n);
      drawNotes(); drawSynth();
    });
    UI.on(root, "click", "[data-remove]", (e, el) => {
      const id = el.dataset.remove;
      if (armed !== id) { armed = id; drawNotes(); return; }
      armed = null;
      notes = notes.filter((x) => x.id !== id);
      saveNotes();
      drawNotes(); drawSynth();
    });
    UI.on(root, "click", "#disc-restore", () => {
      EXAMPLES.forEach((ex) => { if (!notes.some((n) => n.id === ex.id)) notes.push(Object.assign({}, ex)); });
      saveNotes();
      drawNotes(); drawSynth();
    });
    UI.on(root, "click", "a[data-opp]", (e, el) => {
      e.preventDefault();
      ctx.navigate("pipeline", { opp: el.dataset.opp });
    });

    oppListener = () => { if (document.body.contains(root)) { drawNotes(); drawSynth(); } };
    document.addEventListener("ops:opps-changed", oppListener);
  }

  OPS.register({
    id: "discovery",
    title: "Discovery Kit",
    stage: "discover",
    order: 10,
    icon: "search",
    summary: "Interview guides for eight departments, a 2-hour shadowing tally, and a capture log that turns what the floor says into scored opportunities.",
    jd: [
      "Partner with department leaders and frontline teams",
      "Ask sharp questions and map real workflows",
      "Quickly learn unfamiliar business processes",
    ],
    render,
    destroy() {
      if (oppListener) { document.removeEventListener("ops:opps-changed", oppListener); oppListener = null; }
    },
  });
})();
