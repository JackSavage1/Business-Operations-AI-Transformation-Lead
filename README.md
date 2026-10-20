# Throughline

**A working operations-transformation workbench for a health-plan-facing care delivery business.**
It was built as a live demo for a *Business Operations & AI Transformation Lead* interview, to show how I would do the job: see the operation in its data, find the bottlenecks, map how the work actually gets done, prioritize, build AI-enabled fixes with guardrails, and prove adoption and impact.

All data is synthetic, generated in the browser from a seeded model of a growing company. It has health-plan contracts, six markets, an outreach call center, and in-home and telehealth clinicians. There are no real members, plans or PHI.

## Open it

| Option | How |
|---|---|
| Single file | Download `dist/throughline.html` and double-click it. Works offline (fonts fall back to system fonts). |
| From the repo | Open `index.html` in a browser. No server or install needed. |
| GitHub Pages | Settings → Pages → Source: **GitHub Actions**, then push to `main`. The workflow in `.github/workflows/pages.yml` deploys it. |
| claude.ai Artifact | Publish `dist/artifact.html`. In the Claude viewer, the AI Automation Lab can call Claude live; everywhere else it runs a deterministic simulation. |

## The operating loop

The left rail follows the loop I would run on every improvement, and each page proves a specific line of the role.

| Stage | Page | What it does |
|---|---|---|
| Start here | **Start here** | Thesis, live findings from the data, and a map from every job requirement to the page that demonstrates it. |
| | **First 90 Days** | Phased plan tied to the role's success criteria, with a week-by-week timeline and data-driven targets. |
| 1 · See | **Ops Command Center** | Member-engagement funnel (assigned → reached → scheduled → held → completed → billable), automatically ranked bottleneck alerts, market scorecard, call-center panel, and a weekly ops-review generator. |
| 2 · Discover | **Discovery Kit** | Sharp questions, data requests and shadowing checklists for each department, plus pain-point capture that promotes straight into the pipeline. |
| | **Workflow Mapper** | Current-state and future-state swimlane maps of four core processes. It computes lead time, cycle efficiency, handoffs and FTE load, highlights the bottleneck, scores automation fit, and lets you edit steps live. |
| 3 · Prioritize | **Opportunity Pipeline** | Impact × effort matrix, a kanban board from Backlog to Measured, an intake form, scoring, and a prioritization memo. |
| | **Impact & ROI Model** | Driver-based ROI with ramp, payback, a 36-month cash curve, tornado sensitivity, assumptions to validate, and a measurement plan. |
| 4 · Build | **AI Automation Lab** | Call note to structured disposition. Covers PHI redaction, a JSON-schema extraction prompt, hard validation rules, confidence routing, an eval scorecard, a threshold tradeoff, an n8n export, and governance and rollout gates. |
| | **No-Show & Scheduling Optimizer** | No-show driver analysis, an in-browser logistic risk model (AUC and calibration), and an intervention simulator that weighs cost against visits gained. |
| | **Clinician Capacity** | Utilization, where a clinician's day goes, what-if levers (routing, AI documentation, backfill), and a hiring planner. |
| 5 · Adopt & measure | **SOP & Training Builder** | Generates the SOP, RACI, a "what changes for you" section, a quick-reference card, and a competency quiz from the mapped workflow. |
| | **Adoption & Impact** | Adoption curves, pilot vs control with difference-in-differences, an impact ledger (measured vs projected), and stage gates. |

Turn on **Presenter notes** in the rail to see the talking points for each page.

## The stories hidden in the data

The dashboards find these from the numbers. None of them are hard-coded text.

1. **Houston:** reached → scheduled conversion trails the network (gap in bilingual scheduler coverage).
2. **Phoenix:** high no-show rate (long lead times, long drive distances).
3. **Tampa:** chart QA first-pass rate drops in the last six weeks (new clinicians onboarding).
4. **Network:** AHT and ACW jump at week 14 after a scheduling-system change (double entry), and schedule conversion softens with them.
5. **Charlotte:** clinicians near full utilization; show rate slips as lead times grow.

## How it's built

- Static HTML, CSS and vanilla JavaScript. No build step and no framework. Chart.js 4.4.1 is vendored in `vendor/`.
- `js/core/data.js` holds the seeded synthetic dataset plus query helpers (`OPS.q`) and a shared opportunity store (`OPS.opps`) that every page reads and writes.
- `js/core/ui.js` has the formatting, components and themed chart helpers. `js/core/app.js` has the module registry, hash routing, presenter mode and theme handling.
- `js/modules/*.js` contains one file per page, each registering itself with `OPS.register(...)`.
- `js/core/ai.js` is an optional live-Claude bridge (Artifact `sample` capability). Every AI feature has a deterministic fallback, and only redacted text is ever sent.
- Built with AI-assisted development (Claude Code). Several agents built the modules in parallel against one shared contract.

```bash
node tools/build.mjs                 # bundle → dist/throughline.html and dist/artifact.html
node tools/smoke.mjs --all-views     # headless check of every page: desktop, phone, dark
```

## Interview materials

- [`docs/INTERVIEW_PREP.md`](docs/INTERVIEW_PREP.md): positioning, likely questions, KPI cheat sheet, questions to ask.
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md): 3-minute and 7-minute walkthroughs, click by click.
