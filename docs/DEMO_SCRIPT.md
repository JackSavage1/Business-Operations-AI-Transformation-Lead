# Throughline Demo Script

Click-by-click walkthroughs for the interview. Every number below is what the app shows **on default settings** (fresh state; Command Center on All plans, All markets, Last 13 wks). They were read from the running app on Oct 20, 2026. The data is seeded, so you will see the same numbers tomorrow.

**Rule for the whole demo:** talk about their business, not the app. Each stop ends on one number, then move on. If they ask a question, answer it, then ask "Keep going, or stay here?"

### Route cheat sheet

Type `#route` at the end of the address bar to jump anywhere.

| Rail item | Route | | Rail item | Route |
|---|---|---|---|---|
| Start here | `#home` | | AI Automation Lab | `#ailab` |
| First 90 Days | `#plan` | | No-Show & Scheduling Optimizer | `#scheduling` |
| Ops Command Center | `#dashboard` | | Clinician Capacity | `#capacity` |
| Discovery Kit | `#discovery` | | SOP & Training Builder | `#sop` |
| Workflow Mapper | `#workflow` | | Adoption & Impact | `#adoption` |
| Opportunity Pipeline | `#pipeline` | | | |
| Impact & ROI Model | `#roi` | | | |

---

## 1. Before you start (2-minute setup)

1. **Close everything else.** Quit chat and mail apps, turn on Do Not Disturb.
2. **Open the app** in Chrome: the claude.ai link https://claude.ai/artifact/SN1biZDX34e4sFBdU3fBBh (sign in first; add `#home` or `#dashboard` to jump to a page), or double-click `dist/throughline.html` from your laptop. GitHub Pages also works if you enabled it and checked it loads tonight.
3. **Reset state if you practiced.** Most choices are remembered in the browser (filters, tabs, promoted pain points, edited maps, targets, the Adoption selection). Fastest full reset: open the console (**Cmd+Option+J** on Mac, **Ctrl+Shift+J** on Windows), paste, press Enter:
   ```js
   Object.keys(localStorage).filter(k => k.startsWith("throughline.")).forEach(k => localStorage.removeItem(k)); location.reload();
   ```
   This also clears the Presenter notes and Dark theme toggles, so do steps 4 and 6 after it. Reset in whichever file you will present from.
   In-app equivalents if you prefer clicks:
   - Opportunity Pipeline: **Reset to example backlog** → **Confirm reset** (also un-promotes Discovery notes and undoes ROI "Save to opportunity").
   - Ops Command Center: **Reset filters** (appears only when a filter is on); Period back to **Last 13 wks**.
   - Discovery Kit: **Clear tally**, **Restore N examples** if you removed any, and click the **Outreach & call center** tab.
   - Workflow Mapper: **Edit numbers** → **Reset to default** → **Confirm reset**; View back to **Current state**.
   - First 90 Days: **Reset targets**; untick any checklist items.
   - Adoption & Impact: click the **AI call-note drafting** card; **Use measured values**.
   - Not remembered (a reload resets them): ROI inputs, AI Lab threshold, scheduling simulator, capacity levers.
4. **Theme:** in the rail footer, set **Dark theme** to off. Light reads better over video. Flip it once even if it is already light, so it stops following your OS setting.
5. **Zoom:** 90% (Cmd/Ctrl and minus once). Use 80% on a 13-inch screen. Keep the window wider than 900 px, or the rail collapses into a "Menu" button.
6. **Presenter notes:** turn on **Presenter notes** in the rail for your final rehearsal. Warning: they render on the page as dashed "SAY" boxes, so the interviewer sees them on a shared screen. For the live share, either turn them off and keep this script on a second screen or printed (recommended), or open the notes view in a second browser (Safari/Firefox) on your other monitor. The toggle is remembered per browser.
7. **Pre-load tabs:** Tab 1 at `#dashboard` (3-minute) or `#home` (7-minute). Tab 2 at `#ailab`. Switching tabs is faster than the rail when you are nervous.
8. **Share the browser window, not the whole screen.** The rail footer reads "Synthetic data · no PHI". On the claude.ai link it also reads "Live Claude connected" (the AI Lab's **Run with live Claude** button works there and asks you to allow it the first time; click it once tonight so the prompt doesn't surprise you live). In the offline file it reads "Simulation mode (offline AI)". Both are expected.
9. **Fallback ready:** `dist/throughline.html` (about 1 MB, one self-contained file, works offline, same numbers) in a folder you can attach to an email or chat. Also keep 3 screenshots: Command Center (Biggest leak and Needs attention), AI Lab (scorecard and the CN-1006 callout), Adoption & Impact (difference-in-differences).

---

## 2. The 3-minute version (4 stops)

Offer it first: "I put together a working example of how I'd approach the first few weeks here. Want a 3-minute look?"

### Stop 1 · Ops Command Center (0:00–0:50) `#dashboard`

1. Start on **Ops Command Center** (defaults: All plans, All markets, **Last 13 wks**).
2. Scroll to the funnel. Point at the red **Scheduled · Biggest leak** row, then the callout under the funnel.
3. Scroll to **Needs attention**, card 1 (Critical · Network · since W14).
4. Scroll back up and click **Open opportunity OPP-03** in the Biggest leak callout.

**Say:** "This is the member funnel from outreach list to billed visit, and the page finds the leaks on its own. The biggest is Houston: 33.9% of reached members get booked, against a network median of 46.1%. Separately, all six markets stepped down in the same week, W14, when the scheduling system changed, and handle time jumped with it."

**Land:** Houston **−12.2 pts, about $263K a quarter** (≈ +1,061 completed visits).

### Stop 2 · Opportunity Pipeline (0:50–1:30) `#pipeline`

1. The OPP-03 drawer opens on its own: **4 × 4 ÷ 1 = 16.0**.
2. Press **Esc**. Point at **Ranked by score**, item #1.

**Say:** "Every finding lands in one backlog, scored the same way: impact times confidence divided by effort, with a haircut for high PHI risk. Routing Spanish-preferred members to bilingual schedulers ranks first because the data already proves the gap and the fix is a dialer rule."

**Land:** **Score 16.0, #1 of 12, $271K a year.**

### Stop 3 · AI Automation Lab (1:30–2:30) `#ailab`

1. Switch to **tab 2**. Read the KPI row at the top.
2. Scroll to **3 · Batch run: 16 call notes** and point at the callout about CN-1006.
3. Optional: click **CN-1006** in the table to show the trace, then **Esc**.

**Say:** "This is the call-note workflow built end to end. Names, birth dates and member IDs are stripped before the model sees anything, hard rules check the output, and anything clinical or low-confidence goes to a person. Here the model coded a chest-tightness call as a routine confirmation at 95% confidence, and the rule layer caught it. That's why escalation recall is a hard launch gate."

**Land:** **Escalation recall 100% with rules, 80% for the model alone** (intent accuracy 93.8% on 16 labeled notes).

### Stop 4 · Adoption & Impact (2:30–3:00) `#adoption`

1. Click **Adoption & Impact**. The **AI call-note drafting** card (At risk) is selected.
2. Scroll to **Difference-in-differences · AI call-note drafting**.

**Say:** "This is how I'd prove it: pilot agents against the rest of the floor, before and after, so we don't credit the tool for something that moved everyone. After-call work is down 27 seconds against control, and the page still flags the pilot at risk because only 4 of 6 agents use it weekly. I'd rather raise that in week 3 than discover it at day 90."

**Land:** **−27 s after-call work vs control** (95% range −34 s to −19 s).

**Then ask:** "Which of these looks most like your world?"

---

## 3. The 7-minute version (9 stops, one pass through the loop)

See → Discover → Prioritize → Build → Adopt & measure. If you are behind at 2:40, skip stop 4; if behind at 3:10, skip stop 6 (both have a one-line fallback below).

### Stop 1 · Start here (0:00–0:35) `#home`

1. Scroll to **What the data says in 10 minutes** (five cards: Houston, Phoenix, Tampa, Call center, Charlotte).
2. Scroll to **Size the prize**. Drag **Share of each gap closed** to 100%, then back to 50%.

**Say:** "Throughline is a working model of a business like yours: four health plans, six markets, an outreach call center, in-home and telehealth clinicians, chart QA and billing. It's all synthetic. The page computes these five gaps from 26 weeks of data every time it loads, and closing half of the Houston and Phoenix gaps is worth about 724 completed visits a quarter."

**Land:** at 50%, **+724 completed visits and $181K a quarter** (at 100%: +1,448 and $362K).

*Transition:* "Here's where those numbers come from."

### Stop 2 · Ops Command Center (0:35–1:25) `#dashboard`

1. Click **Ops Command Center**. Point at the **Biggest leak** callout under the funnel.
2. Scroll to **Needs attention**, card 1 (Network, since W14).
3. Scroll to the **Call center** panel: AHT 7:49, ACW 2:17.

**Say:** "Houston converts 12 points below the network, worth about $263K a quarter. The alert I'd chase first is this one: schedule rate stepped down in six of six markets in the same week the scheduling system changed, and after-call work rose 41 seconds. When every market moves in one week, I look for a shared cause."

**Land:** **6 of 6 markets at W14; ACW 1:36 → 2:17 (+41 s).**

*Transition:* "Before I trust a number, I ask the people doing the work."

### Stop 3 · Discovery Kit (1:25–2:00) `#discovery`

1. Click **Discovery Kit**. The **Outreach & call center** guide is open. Point at **Sharp questions**.
2. Scroll to the capture log. On the second card (Handoff · Bilingual outreach agent), click **Promote to opportunity**. A toast confirms OPP-13.

**Say:** "These are my first-two-weeks interviews: a leader and a frontline person in every department. The questions ask for a walkthrough or a number, so I can check the answer against the data. Anything worth fixing goes straight into the pipeline."

**Land:** **6 pain points, about 58 team hours a week, 6 of 8 departments heard** (Synthesis so far).

*Transition:* "Then I map how the work actually moves."

### Stop 4 · Workflow Mapper (2:00–2:40) `#workflow`

1. Click **Workflow Mapper**. The detail panel already shows **Step 8: Re-key the visit request** (automation fit 95/100).
2. Click **Compare**.

**Say:** "Since the W14 cutover, every booked visit gets typed into two systems. That's my first hypothesis for the after-call-work jump, and I'd confirm it by sitting next to a scheduler. The redesign books the slot on the call through the scheduling API, so the fix is an integration and a process change before it's an AI project."

**Land:** **−1,300 labor hours a month (about 8.1 FTE); lead time 18.5 → 13.4 days.**

*If skipped, say on the Command Center:* "My first hypothesis is double entry after the cutover, and I'd confirm it on the floor before building anything."

*Transition:* "Everything I find goes into one backlog."

### Stop 5 · Opportunity Pipeline (2:40–3:10) `#pipeline`

1. Click **Opportunity Pipeline**. Point at **Ranked by score** #1.
2. Click **See all 13 in the table** (12 if you skipped the promote). OPP-13 sits at the bottom with **2.0**.
3. Click the title **Route Spanish-preferred members to bilingual schedulers** (top row), then **Model ROI** in the drawer.

**Say:** "One score for everything: impact times confidence over effort, with a haircut for high PHI risk. The callback complaint I just promoted scores 2 on its own. The same problem, backed by Houston's data, scores 16 and goes first. That's why I pair what I hear on the floor with the numbers."

**Land:** **OPP-03 scores 16.0, #1; $271K a year.**

### Stop 6 · Impact & ROI Model (3:10–3:45) `#roi` (opens on OPP-03)

1. Read **Net annual benefit**.
2. Click **Conservative**, then **Base**.
3. Point at the warning callout at the top of **Assumptions to validate**: "3-year ROI above 1,000%".

**Say:** "I size every idea from explicit drivers, so a leader can argue with an input instead of the conclusion. Even the conservative case is about $200K a year. And the model warns me the ROI looks too good because the build cost leaves out internal time, so I'd fix that before it goes to finance."

**Land:** **$292K net a year (base), $202K conservative, payback in month 1.**

*If skipped, say in the pipeline drawer:* "Sized from explicit drivers, this one nets about $290K a year even before I validate the visit lift."

*Transition:* "The W14 problem also has an AI piece: the notes agents write after every call."

### Stop 7 · AI Automation Lab (3:45–4:55) `#ailab`

1. Switch to **tab 2**. Read the KPI row.
2. Scroll to **3 · Batch run**; click **CN-1006** to show the trace (model output vs after validation); **Esc**.
3. Scroll to **5 · Where to set the auto-post threshold**. Drag the slider **85% → 80%**, read the result, drag back to **85%**.

**Say:** "The model is the easy part. Redaction before the call, rules that override the model, confidence routing and an eval against reviewer labels are what make it safe in a HIPAA shop. This slider is the conversation I'd have with the call-center manager: at 85%, 11 of 16 notes post on their own with zero errors; at 80% the one extra note that posts is wrong. Sixteen notes is a demo; the real decision uses 300 double-labeled notes from shadow mode."

**Land:** **Escalation recall 100% (model alone 80%); at 80% threshold, 1 wrong auto-post.**

*Transition:* "Same pattern on scheduling, with a real statistical model."

### Stop 8 · No-Show & Scheduling Optimizer (4:55–5:40) `#scheduling`

1. Scroll to **No-show risk model**. Point at **0.71** (test AUC) and the model card's **Allowed use** line.
2. Scroll to **Intervention simulator** (**Recommended** is selected). Read Extra completed visits and Net monthly impact.
3. Tick **Overbook High-tier slots**. Point at **Double-booked slots: 106 / mo, More collisions than visits**. Untick it.

**Say:** "The model is fitted in the browser on weeks 15 to 22 and tested on weeks it never saw. It decides who gets extra outreach and is never used to deny or delay a visit. The recommended plan is two-way texts, a live call for the high-risk tier and a same-day backfill list. If I turn on overbooking, it adds 24 visits and creates 106 double-bookings a month, so overbooking stays off."

**Land:** **+291 completed visits and $61.8K net a month** (overbooking: +24 visits vs 106 double-bookings).

*Transition:* "Then the part most projects skip: adoption and proof."

### Stop 9 · Adoption & Impact (5:40–6:40) `#adoption`

1. Click **Adoption & Impact** (AI call-note drafting selected, At risk). Point at the difference-in-differences table.
2. In **Try the method**, change **Control after (sec)** from 137 to **120**. The effect shrinks from −27 s to −10 s. Click **Use measured values**.
3. Scroll to **Impact ledger**.

**Say:** "This is a simulated rollout; the method is the point. Pilot agents are measured against the rest of the floor. If the whole floor had also improved, the claimed effect would shrink from 27 seconds to 10, and the method catches that. The ledger puts projected next to measured, and only numbers measured against a control count as hard savings."

**Land:** **−27 s ACW vs control; ledger: +663 visits a quarter measured with control.**

### Close (6:40–7:00)

Use the closing line in section 6, then ask: "Which of these is closest to what you're dealing with now?"

---

## 4. If they ask…

### "How did you build this?"
**Click:** point at the footer ("built with AI-assisted development (Claude Code)"), then AI Lab **7 · Build artifacts** → **Prompt template**, **JSON schema**, **n8n workflow**.
**Say:** "I built it with Claude Code. [Say exactly what you did, truthfully: for example the brief and data model you wrote, the metrics and guardrails you chose, how you reviewed and tested each page.] It's static HTML and JavaScript with no framework and no server, the data is synthetic and generated in the browser, every AI feature has a deterministic fallback, and a smoke test checks every page on desktop, phone and dark mode. That's the job description's 'prototype lightweight solutions with AI-assisted development', and I can explain every method on screen."
Only claim time spent or hands-on work that is literally true.

### "How would this work with our real data?"
**Click:** Discovery Kit → **Engineering & data (partner)** tab → **Data to request**; then the **Outreach & call center** tab's data list.
**Say:** "Week one, I'd ask for read-only exports and rebuild the Command Center on them: roster or eligibility file for assigned members, dialer and ACD interval data for attempts, reached, AHT and ACW, CRM dispositions for scheduled, the scheduling system for held, no-show and lead time, the clinician app or EHR for completed visits and documentation time, chart QA for first-pass, and billing for revenue. Aggregates and counts first, no member identifiers. I'd lock the definitions with ops and finance, then build it in your BI tool. I expect your bottlenecks to look different from these."

### "What about HIPAA?"
**Click:** AI Lab **2 · PHI minimization** (original vs redacted note), then **8 · Governance and rollout** guardrails.
**Say:** "Minimum necessary by design. Identifiers are redacted before any model call, and a residual scan blocks the call if anything is left: across the 16 notes, 53 identifiers removed and 0 residual. Only BAA-covered vendors with zero data retention, no PHI in automation logs, an audit row for every run, a human on every clinical or complaint case, and a kill switch the call-center manager owns. Reminder texts carry date, time and a callback number only, with TCPA consent on file. I'd bring compliance in as a co-designer in week one."
Extra proof: Command Center **Draft with Claude** sends aggregates only; the SOP's prerequisites ban personal AI accounts for member data.

### "How accurate is the AI?"
**Click:** AI Lab **4 · Evaluation scorecard**.
**Say:** "On 16 labeled synthetic notes: intent accuracy 93.8%, up from 87.5% for the model alone; barrier F1 90%; escalation recall 100%, up from 80%; all fields right on 13 of 16. At the 85% threshold, 11 notes auto-post and all 11 are fully correct. To be clear, the batch here runs a simulated extractor, so these numbers show the method and are not a claim about any model. The production decision uses 300+ double-labeled real notes in shadow mode, with escalation recall at 100% as a hard gate."
For the no-show model: test AUC **0.71** (train 0.75) on out-of-time weeks; the High tier predicts 36.8% and actually no-shows 30.4%, so it runs slightly high. Refit monthly or if AUC drops below 0.65.

### "How do you get adoption?"
**Click:** SOP & Training Builder → **What changes for you** tab; then Adoption & Impact → **Adoption risk signals → nudges** and **Adoption playbook**.
**Say:** "Every role gets an old-way, new-way card: schedulers simply stop re-keying. Training totals 48 hours and pays back in about a day and a half. Then I watch usage weekly. Here the two low adopters are both bilingual agents, editing 57% and 62% of drafts, which tells me the tool is weaker on Spanish-language calls, so I'd fix the prompt before I coach the people. Champions on each shift, office hours, and a stop-doing list so the new way replaces work instead of adding to it."

### "What would you do in week 1?"
**Click:** First 90 Days → phase **1. Learn & baseline** checklist; Discovery Kit → **2-hour shadowing checklist**.
**Say:** "Listen and get data. Meet every department leader and agree their top three priorities, shadow outreach, scheduling, chart QA and billing for two hours each, and request read access to the funnel, ACD interval data, the scheduling export and QA results. By day 30: a baseline KPI sheet signed off by each owner, a current-state map from roster file to billed visit, and a readout with the proposed bets. Nothing touches a member or a system of record in week one."
Day dates on screen: Day 1 Nov 2, Day 30 Dec 1, Day 60 Dec 31, Day 90 Jan 30.

### Other likely asks
- **"Is this real data?"** "No. It's fully synthetic, modeled on how a business like yours works. The real version starts with your data in week one, and I'd expect your bottlenecks to differ."
- **"What about clinicians / Charlotte?"** Click **Clinician Capacity**. "Network utilization looks healthy at 81%, and it hides two problems: Charlotte is 97% booked and members wait 16.6 days; Phoenix has open slots and 49 minutes of driving per visit. The four levers add 288 visits a month with the same roster. Charlotte needs hires either way; the planner says open the first requisition now and use the levers to buy runway while credentialing runs."
- **"What would you not automate?"** "Clinical safety stays a rule, never a confidence threshold. Overbooking stays off. Charlotte gets hires, not just more squeeze."
- **"Pipeline says bilingual routing is in Discovery, but Adoption shows it launched."** "The Adoption page is a simulated rollout showing how I'd track it after launch. The pipeline shows today's stage."
- **"Why do the numbers differ slightly between pages?"** Each page uses its own window and comparison (last 4 weeks vs other markets, or 13 weeks vs network median), and each says which. Example: Houston is $264K a quarter on Start here and $263K on the Command Center callout.
- **"Is the AI live?"** "In this file it runs a deterministic simulation offline. Published as a Claude artifact, the same button calls Claude on the redacted note."

---

## 5. Recovery lines

**Short on time:** "Let me skip to the one thing that matters most." Then pick one:
- Ops audience: Command Center **Biggest leak** callout. "Houston books 12 points fewer reached members than the network, about $263K a quarter, and the fix is a dialer rule."
- AI audience: AI Lab **3 · Batch run** callout. "The model was 95% confident and wrong on a chest-tightness call; the rule caught it. The controls are the product."

**Something breaks:**
- Red box "This page hit an error": press **Cmd/Ctrl+R**. You stay on the same page. "Prototype moment. Here it is."
- Clicked the wrong thing: **Esc** closes drawers and dialogs; browser **Back** returns to the previous page.
- A chart is blank: talk from the KPI tiles, which carry the same numbers.
- Whole app blank: open `dist/throughline.html` and type the route.
- Lost your place: click **Throughline** at the top of the rail to return to Start here; its **Suggested 7-minute demo path** lists the order.

**Screen share fails:** "No problem, I'll send you the file. It opens in any browser with nothing to install." Email or chat `dist/throughline.html`, then guide them by rail names ("click Ops Command Center on the left"). If that fails too, use your three screenshots.

**They interrupt or challenge a number:** "Good question. It's synthetic, so the specific number isn't the point; on your data I'd expect something different. What I'd keep is the method." Then answer, and ask whether to continue.

---

## 6. Closing line

> "Your posting says success is measured by real-world business impact, not the number of analyses. That's how this is built: every finding ends in a number someone owns, and only results measured against a control count. On this model, the 90-day targets add up to about 717 completed visits and $179K a quarter. On your data the numbers will differ, and I'd want to be measured on them the same way."

(Source for 717 / $179K: First 90 Days → **90-day targets**, totals row, default targets.)

---

