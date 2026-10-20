# Interview Prep: Business Operations & AI Transformation Lead

Read in full tonight (about 20 minutes). Tomorrow, skim the bold lines and the tables.

**Your thesis:** "I find where the member funnel and the operating model leak, fix it with the simplest tool that works (a process change, an automation, or AI with guardrails), get the frontline using it, and prove the impact in visits, hours, and dollars." Every answer below is a version of that sentence.

**Ground rule:** every personal claim must be true. Brackets like `[this]` are yours to fill. If you can't fill one honestly, cut the clause. A shorter true answer beats a longer inflated one.

---

## 1. Positioning

### 30-second pitch, Variant A: the operator who builds

> "I'm an operations person who builds. Over the last [X years] in [your field], my work has been [one-phrase pattern, e.g. turning manual, messy workflows into measured, repeatable ones]. Lately that means building the tools myself with AI, automation, and dashboards, then getting the team to actually use them. Your business is a funnel with people at every stage (members, schedulers, clinicians, QA), and the gains come from small, measured fixes across all of it. I built a working example of how I'd approach it, if it's useful later."

### Variant B: the analyst or consultant who ships

> "I've spent [X years] diagnosing operations problems in [industries], and what I've gotten best at is the step most analyses skip: implementation and adoption. I map how work actually gets done, find the constraint in the data, and ship the fix, whether that's a process change, an automation, or an AI-assisted workflow with validation. Your posting says success is measured by real-world business impact, not analyses. That's how I want to be measured."

Pick one. Say it aloud five times. Keep it under 35 seconds, then stop talking.

### The 2-minute "walk me through your background"

| Time | Beat | What to say |
|---|---|---|
| 0:00–0:15 | Headline | First sentence of your pitch. |
| 0:15–1:15 | 2–3 chapters | Each: [context, one line] → [problem you owned] → [what you built or changed] → [a real number, if you have one]. End each with what it taught you to do. |
| 1:15–1:40 | The thread | "The common thread is..." map the work, find the bottleneck, build, drive adoption, measure. |
| 1:40–2:00 | Why here, why now | Healthcare ops at scale, AI tools now practical to ship, a role that owns outcomes. Offer the demo. |

Relevance beats chronology. Skip jobs that don't serve the thread. Stop at 2:00.

---

## 2. What this company most likely cares about

- **The customer is the health plan; the member is who you serve.** Plans pay for completed, documented services that engage members, close care gaps, support HEDIS and Star performance, and document member health accurately.
- **The revenue unit is the completed, QA-passed visit.** Every leak between roster and billed visit is lost revenue and a member who didn't get care.
- **Clinician time is the scarcest resource** (state-licensed, credentialed, expensive). The call center is the largest labor pool.
- **Growth breaks processes.** New plans bring new roster files and contract terms; new markets need clinicians recruited and credentialed.
- **Compliance is the license to operate:** HIPAA, TCPA consent for calls and texts, CMS rules on Medicare Advantage communications, documentation integrity for risk adjustment.
- **Timing:** it's late October. The HEDIS measurement year ends December 31, so Q4 is usually a gap-closure push. Ask about it.

### The funnel (memorize)

**Roster / eligible → Attempted → Reached → Scheduled → Showed → Completed → Chart QA passed → Billed to plan**

Two summary numbers: **end-to-end yield** (billed ÷ eligible) and **attempts per completed visit**.

### KPIs to speak fluently about

Ranges are **rough, industry-typical figures for orientation only**. They vary widely by population, data quality, and visit type, and **they are not facts about this company**. Phrase it as: "In my understanding it's often around X. What does it look like for you?"

| KPI | Plain definition | Rough typical range | What moves it |
|---|---|---|---|
| **Contact rate** | Members reached (right person) ÷ attempted | 35–65% per campaign | Phone data quality, call timing, SMS consent, cadence |
| **Schedule rate** | Scheduled ÷ reached | 30–60% | Script, language match, slot offered on first call |
| **No-show rate** | Missed appointments ÷ scheduled (show rate is the rest) | 10–25% | Lead time, two-way reminders, transport and other SDOH |
| **Completion rate** | Completed ÷ scheduled | 65–85% | All of the above, plus clinician lateness and telehealth tech failures |
| **Visits per clinician-day** | Completed visits ÷ clinician days | In-home 4–7; virtual 8–14 | Drive time, routing, backfill, documentation time |
| **Utilization** | Booked clinical time ÷ available time | Healthy 75–90% | Above 95% sustained means no slack and burnout risk |
| **AHT / ACW** | Talk + hold + after-call work; ACW is the wrap-up | AHT 4–8 min; ACW 30–90 sec | Double entry, system speed, note burden |
| **FCR** | Resolved on first contact | 70–85% | Scheduling in-call, routing to the right skill |
| **ASA / abandon** | Inbound wait to answer; share who hang up waiting | ASA under 30–60 sec; abandon under 5–8% | Staffing vs forecast, callback options |
| **Chart QA first-pass** | Charts passing QA without rework ÷ submitted | 90–97% | Templates, pre-submit checks, clinician tenure |
| **Chart lag** | Days from visit to chart submitted (and billed) | Submit in 1–3 days; bill in 1–2 weeks | QA bounces, missing fields, backlog |
| **Cost per completed visit** | Outreach + clinician + travel + QA + overhead ÷ completed | Too business-specific to quote; build bottom-up | Every rate above; compare to revenue per visit by plan |

**The core seven to own cold:** contact rate, schedule rate, no-show rate, completion rate, visits per clinician-day, AHT/ACW, chart QA first-pass.

---

## 3. How to use the Throughline demo

### When to show it

- **Offer it; don't force it.** Good openings: after your background answer, at "tell me about something you built," at "first 90 days," or at "questions for us?"
- Offer line: "I put together a working example of how I'd approach the first few weeks here. Want a 3-minute look, or should we keep talking?" If they say later, wait.
- Before the call: app open in its own tab, other tabs closed, the offline file `dist/throughline.html` ready as a backup. **Presenter notes OFF while sharing**: they render on the page as "SAY" boxes, so the interviewer would see them. Rehearse with them on tonight.
- **Talk about their business, not the app.** Every page is a prompt for "here's how I'd find this in your data." If a page differs from these notes, describe what's on screen.

### "Is this real data?"

> "No. It's fully synthetic, modeled on how a business like yours works: health plans, markets, a call center, clinicians, chart QA. I built it with Claude Code, directing several AI agents against one spec I wrote, to show how I'd work, not to guess at your numbers. The real version starts with your data in week one, and I'd expect your real bottlenecks to differ."

If they ask how you built it: you directed an AI coding tool, made the design calls (what to measure, which guardrails, how to validate), and reviewed the output. That is the JD's "prototype lightweight solutions using AI-assisted development tools." Be ready to explain every method on screen yourself (see "Know it cold").

### The walkthrough

Use **[DEMO_SCRIPT.md](DEMO_SCRIPT.md)** for the click-by-click 3-minute and 7-minute versions. It is the single source of truth and was checked against the running app. The numbers to land, on default settings:

| Page | The line |
|---|---|
| **Start here** | The loop is See → Discover → Prioritize → Build → Adopt & measure. Five findings are computed live from the data. |
| **Ops Command Center** | Four Critical alerts: the W14 network schedule-rate drop (all six markets in the same week), Houston conversion about 12 points below the other markets, Phoenix show rate 71.0% (no-show about 22.7%), Tampa QA first-pass down about 9 points since W21. AHT/ACW after W14 is the next alert (Serious). |
| **Workflow Mapper** | Schedulers re-key the visit request into the scheduling system since the W14 change. Double entry is the first hypothesis to test for the W14 drop, not a proven cause. |
| **AI Automation Lab** | On 16 notes, a **simulated** extractor (not a real model's measured accuracy) gets 93.8% intent accuracy. Hard rules lift escalation recall from 80% to 100%: they catch the shortness-of-breath call the model coded as a routine confirm. |
| **Clinician Capacity** | Charlotte is about 97% utilized. Levers (routing, backfill, AI documentation assist) buy runway, but the first requisition should open now. |
| **SOP & Training** | Full SOP with RACI, plus a one-page quick-reference card and 15-minute role-based training modules. |

Tampa, if asked: "QA first-pass dropped as new clinicians onboarded. I'd test pre-submit checks and structured templates before blaming people."

### Know it cold

- **No-show model:** logistic regression on 20 inputs, fitted in the browser (trained W15–W22, tested W23–W26, test AUC 0.71). Biggest multipliers: prior no-show ×2.6, no reminder ×2.1, 8–10am slot ×1.7, confirmed ×0.5. Used to target outreach, never to deny or delay care.
- **Difference-in-differences:** (pilot after − pilot before) − (comparison after − comparison before). Removes shared trends. Name the assumption: both groups trended in parallel before the change.
- **Confidence routing:** low-confidence or rule-failing outputs go to a human queue. Tune the threshold by trading automation rate against error rate on the eval set.
- **Eval scorecard:** per-field accuracy against hand-labeled truth. The demo's extractor is a deterministic simulation; say so. 16 notes is demo-sized; a real pilot needs a few hundred real calls double-labeled by QA.

---

## 4. Likely questions and answer frameworks

### STAR template for every personal story

**[Situation]** 1–2 sentences: team, scale, why it mattered. **[Task]** What *you* owned ("I," not "we"). **[Action]** 3–4 concrete steps: what you looked at, who you talked to, what you built, how you validated. **[Result]** A real number (hours, %, $, days) and what happened after. **[Learning]** One sentence on what you'd do differently; interviewers remember this line.

**Fill in four stories tonight:** (1) a process you redesigned, (2) an automation or AI workflow you personally built, (3) a skeptic you won over, (4) a project that failed or underdelivered.

---

**1. "How do you map a process you don't know?"**
- Quick SIPOC to set boundaries, then shadow the work: sit with a scheduler, listen to calls, watch a QA reviewer.
- Draw a swimlane of what *actually* happens: steps, handoffs, systems, waits, rework, workarounds.
- Check it against system timestamps. Where data and interviews disagree is usually where the finding is.
- Play it back to the frontline: "Did I get this right?"

**2. "How do you find bottlenecks?"**
- Break the funnel down by stage and segment (market, plan, agent, clinician, week). Look for drops in conversion and growing queues.
- Look for variance: same process, different result (Houston). Look for rework (QA bounces), lost handoffs (callbacks that never happen), and step changes (week 14).
- Confirm on the floor before building anything.

**3. "How do you prioritize?"**
- Score impact (visits, hours, dollars), confidence, and effort. Treat compliance risk as a gate, not just a weight.
- One or two quick wins in month one to earn trust; start one bigger bet early.
- Align with what leaders are already measured on. Keep a visible ranked backlog so "not now" isn't "never."

**4. "Tell me about an AI workflow you built. How did you validate it?"** *(Story 2)*
- [Situation: the manual task, its volume, the cost of errors] → [Action: tool, how you structured it, what was checked automatically, where a human stayed in the loop] → [Result].
- **Validation is what they're listening for:** a labeled test set built before launch, per-field accuracy, review of failure cases, a "good enough to pilot" threshold, and monitoring after launch (override rate, spot checks).
- If your example is small or personal, say so and stress the rigor. The AI Lab page can show your method.

**5. "How would you handle PHI and HIPAA with AI tools?"**
- **Approved tools only, under a BAA.** No consumer accounts; no member data in a personal chat.
- **Minimum necessary:** redact or tokenize names, DOBs, and member IDs before the model call; re-link inside your own systems.
- **Human in the loop** for anything that changes a member record or touches clinical content.
- **Audit trail:** prompt version, model version, input reference, output, approver. Add access controls, retention settings, evals, monitoring, and an incident path.
- Bring compliance and security in early as co-designers; it makes approval faster.

**6. "How do you get frontline adoption?"**
- Two or three frontline champions shape the tool from the first prototype.
- **The new way must take fewer clicks than the old way.**
- Train inside the workflow: SOP plus one-page quick-reference card, 15-minute role-based walkthrough, desk cheat sheet.
- Measure usage, overrides, and workarounds; hold a weekly 15-minute feedback loop for the first month; retire the old path once stable.

**7. "A department leader resists your change. What do you do?"** *(Story 3)*
- Start with their goals and pressures. Ask what they've tried before.
- Show them the data privately first. Never surprise a leader in a group meeting.
- Shrink the ask to a 2-week pilot on a team they pick, with a metric they agree to. Make the win theirs.
- [Their concern] → [what you learned by listening] → [how you adjusted] → [outcome].

**8. "When do you build it yourself vs. involve engineering?"**
- **Build yourself:** reversible, small user group, within approved tools and data access, goal is learning.
- **Involve engineering:** writes to a system of record, PHI at scale, needs uptime, integrates with the EHR or scheduling system, or multiple teams depend on it.
- **"I prototype to learn what's needed; engineering builds what has to be supported."** Hand off a spec, an eval set, metrics, and the prototype as a living requirement.

**9. "How do you measure impact and know it was your change?"**
- Baseline 4–8 weeks with the KPI defined in writing before launch.
- A comparison group: staggered rollout, pilot vs similar sites, or randomize by agent or week.
- Difference-in-differences to remove seasonality and the year-end push. Report uncertainty and guardrail metrics (quality, member experience, compliance).
- Translate into visits, hours, and dollars.

**10. "Tell me about a project that failed."** *(Story 4)*
- A real failure, not a disguised strength. Own your specific part.
- [What you assumed] → [what happened] → [how you found out] → **[the habit you changed]**, e.g. "now I measure adoption from day one" or "now I shadow before I build."

**11. "What would you do in your first 90 days?"**
- **Days 1–30, learn:** shadow scheduling, call center, clinical, QA, finance, customer success; get data access; baseline the funnel; publish an opportunity list.
- **Days 31–60, ship:** two quick wins live and measured; start one AI-enabled workflow with engineering, with evals and guardrails.
- **Days 61–90, prove and scale:** results against baseline, scale what worked, a weekly KPI scorecard, a ranked pipeline for next quarter. (Show the First 90 Days page.)

**12. "How familiar are you with SQL, Power BI, n8n, Zapier?"**
- **Be exact about depth. Never overclaim; they may test.** "I've used it for [task]; I'm [comfortable / learning] with [feature]."
- Working knowledge means: **SQL**, joins, GROUP BY, CTEs, window functions for a weekly funnel. **Power BI**, a clean data model, measures, row-level security by plan. **n8n**, webhooks, branching, retries, error handling; self-hostable, which matters for PHI. **Zapier / Make**, quick SaaS glue; confirm the vendor signs a BAA on your tier before PHI flows through.
- For a gap: "I haven't used n8n in production; I'd be productive within a week because [similar tool you've used]."

**13. "How would you improve visit completion?"**
- Decompose contact → schedule → show → complete; fix the biggest leak first, by segment.
- **Contact:** phone data hygiene, best time to call, consented SMS. **Schedule:** slot on first call, language-matched agents (Houston), telehealth option.
- **Show:** shorter lead times, risk-based two-way reminders, transport help (Phoenix). **Complete:** analyze incomplete-visit reasons; pre-visit tech checks for telehealth.

**14. "How would you improve call-center productivity?"**
- Measure **scheduled visits per agent hour**, not calls per hour.
- Split AHT into talk, hold, ACW; look for step changes (week 14) and agent variance.
- Levers: list hygiene, dialer pacing, removing double entry, AI-drafted notes and dispositions, in-call knowledge base, skill routing.
- Guardrails: quality scores, member experience, TCPA.

**15. "How would you increase completed visits per clinician?"**
- Decompose: available hours × utilization × visits per booked hour × completion rate.
- Levers: zip-cluster routing, overbooking calibrated to no-show risk, same-day backfill, faster documentation through templates and pre-submit checks.
- **Know when not to push:** a team at 97% (Charlotte) needs hiring and faster credentialing. Efficiency levers buy runway; they don't replace the hire.

**16. "How would you automate reconciliation?"**
- Example: plan eligibility roster vs internal member file, or completed vs submitted vs paid visits.
- Define match keys → automate the diff on a schedule (SQL or n8n) → **classify exceptions** (termed, moved, deceased, ID mismatch) → only exceptions reach a human queue.
- Controls: counts and totals that must tie, an audit log, an owner per exception type. Measure cycle time, error rate, and outreach to termed members avoided.

**17. "Why this role? Why healthcare operations?"**
- [Your genuine reason: a personal connection, the scale of impact, how you like to work.] Tie it to "real-world business impact" as the scorecard you want.

---

## 5. Healthcare-ops vocabulary cheat sheet

| Term | Meaning | Use it like this |
|---|---|---|
| **Medicare Advantage (MA)** | Private plans delivering Medicare benefits, paid by CMS | Biggest driver of in-home assessments and Star-focused outreach |
| **Medicaid managed care** | State Medicaid run through contracted plans | More SDOH barriers, phone churn, language needs |
| **D-SNP** | Dual Eligible Special Needs Plan (Medicare + Medicaid) | Complex, hard-to-reach, high-value members |
| **Star ratings** | CMS 1–5 star quality rating for MA plans; affects plan payment | "Closing gaps supports the plan's Star performance" |
| **HEDIS** | Standardized quality measures (screenings, diabetes care, etc.) | Measurement year ends Dec 31, hence the Q4 push |
| **Care gaps** | Recommended services a member hasn't received | The reason for outreach |
| **HRA** | Health Risk Assessment of a member's health status and needs | Often the core visit type |
| **Risk adjustment / HCC** | CMS adjusts plan payment by documented member health status; diagnoses group into HCCs | **Say:** "complete, accurate, supported documentation of what the clinician assessed." **Never** "finding codes" or "raising scores." Keep coding QA independent; this area draws audit scrutiny. |
| **SDOH** | Social drivers of health: transport, housing, food, language | Explains no-shows; capture and refer |
| **Eligibility / roster file** | The plan's list of members to engage, usually monthly | Where reconciliation and data quality start |
| **BAA** | Business Associate Agreement, required before a vendor handles PHI | "Any AI tool touching PHI needs a BAA first" |
| **PHI** | Identifiable health information | Redact before it reaches a model unless that use is approved |
| **Minimum necessary** | Use and share only the PHI the task needs | Your design rule for every AI workflow |
| **Credentialing** | Verifying a clinician's license and qualifications before they see a plan's members | A capacity bottleneck in new markets |
| **TCPA** | Federal law on autodialed calls and texts; consent matters | Raise it whenever SMS reminders come up |

---

## 6. Questions to ask them

Pick 4–5 for each interviewer. Write down the answers; use them in your close and follow-up note.

**Business and operations**
1. "Between roster and billed visit, where do you lose the most members, and is it the same in every market?"
2. "How is the year-end gap-closure push going, and what breaks first when volume spikes?"
3. "Which plan contract terms create the most operational pressure: visit targets, turnaround, reporting?"

**Data and tools**
4. "Does a member's journey live in one system of record, or in exports stitched together?"
5. "Which AI tools are approved today, are BAAs in place, and who signs off on new uses?"
6. "How do managers get their numbers now, and how much of that is manual?"

**Success and ownership**
7. "Ninety days from now, what would make you say this hire was clearly the right call?"
8. "What's an improvement the team tried that didn't stick, and what got in the way?"
9. "Would I own the KPI outcome, or the delivery of the change with the department owning the KPI?"

**Team and engineering partnership**
10. "How does engineering take requests from operations, and what's the path from a prototype to a supported tool?"
11. "What guardrails exist today for low-code automations that touch PHI?"
12. "Which two or three leaders would I work with most in the first month?"

---

## 7. Risk-reducers: make hiring you feel safe

- **Show the working demo.** It proves you can build, which is the hardest thing for them to verify in an interview.
- **Offer a 30/60/90** (Question 11), and offer to send a one-page version afterward.
- **Propose a first-two-weeks discovery plan.** Week 1: shadow a scheduler shift, listen to 20 calls, sit with QA, meet finance on reconciliation, get read access to funnel data. Week 2: baseline the core seven KPIs, map the top two workflows, publish a sized and ranked opportunity list, agree on the first quick win and its owner.
- **Quote their line back:** "Your posting says success is measured by real-world business impact, not the number of analyses. I'd like my first 90 days judged that way."
- **Raise risk unprompted:** minimum necessary, BAAs, human-in-the-loop, TCPA.
- **Show you know when not to automate:** if the week-14 drop is double entry, that's an integration or process fix before it's an AI project; Charlotte needs a hire, with levers only buying time.
- **Be precise about skill levels.** Calibrated honesty reads as low-risk.

---

## 8. Night-before checklist

- [ ] Open Throughline in the browser you'll use. Click every page; check light and dark; rehearse with presenter notes on, then turn them off before you share your screen.
- [ ] Rehearse the 3-minute demo aloud twice with a timer.
- [ ] Save backup screenshots: Command Center, AI Lab, Adoption & Impact.
- [ ] Say your pitch aloud five times; time the 2-minute background.
- [ ] Fill in all four STAR stories with real details. Cut anything you can't defend.
- [ ] Memorize the funnel and the core seven KPIs.
- [ ] Read the company site: plan types, markets, visit types, recent news. Look up each interviewer.
- [ ] Choose 2 questions per interviewer from Section 6.
- [ ] Rehearse "Is this real data?" word for word.
- [ ] Test camera, mic, and screen share; silence notifications; water nearby; sleep.

### Closing statement template

> "Thank you for the time. From what I heard, your biggest opportunities are [what they told you, e.g. scheduling conversion in newer markets] and [second thing]. That's the work I want to own: map how it actually runs, ship the simplest fix that works, get the team using it, and show the impact in visits, hours, and dollars. In my first two weeks I'd [one discovery step tied to what they said]. I'm excited about this role, and I'm happy to send a one-page 30/60/90 if it helps your decision. What are the next steps?"
