/* Throughline: SOP & Training Builder (#sop).
 *
 * Generates a standard operating procedure, role-by-role change notes, a quick-reference card, and a
 * training plan with a competency check from the Workflow Mapper's process library (OPS.processes).
 * When the viewer has edited a map in Workflow Mapper, the documents follow those edits.
 */
(function () {
  "use strict";
  const OPS = window.OPS;
  const UI = window.UI;
  if (!OPS || !UI) return;

  const VERS = [{ value: "future", label: "Future state (train on this)" }, { value: "current", label: "Current state (as-is)" }];
  const TABS = [{ value: "sop", label: "SOP" }, { value: "changes", label: "What changes for you" }, { value: "qrc", label: "Quick reference" }, { value: "training", label: "Training & check" }];
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const isActive = (s) => s.change !== "Eliminated";
  const WF = () => OPS.workflow || null;
  const AUTHOR = "Ops transformation lead";

  // ---------- formatting (reuse Workflow Mapper's when present) ----------
  const trimNum = (v, d) => { const s = Number(v || 0).toFixed(d); return s.indexOf(".") >= 0 ? s.replace(/\.?0+$/, "") : s; };
  const fmtMin = (m) => (WF() ? WF().fmt.min(m) : trimNum(m, 1) + " min");
  const fmtWait = (h, long) => (WF() ? WF().fmt.wait(h, long) : trimNum(h, 1) + " hrs");
  const fmtLead = (h) => (WF() ? WF().fmt.lead(h) : trimNum(h, 1) + " hrs");
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
  const mdCell = (t) => String(t == null ? "" : t).replace(/\|/g, "/").replace(/\n+/g, " ");

  function slaText(h) {
    h = +h || 0;
    if (!h) return "immediately";
    if (h <= 1) return "within 1 hour";
    if (h <= 4) return "within 4 business hours";
    if (h <= 8) return "the same business day";
    if (h <= 24) return "within 1 business day";
    if (h <= 72) return "within " + Math.ceil(h / 24) + " business days";
    return "within " + Math.round(h / 24) + " calendar days";
  }
  function addDays(iso, n) {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function rng(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    let a = h >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, r) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function redact(t) {
    return String(t)
      .replace(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, "[PHONE]")
      .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "[DATE]")
      .replace(/\b[A-Z]{2}\d{6,}\b/g, "[MEMBER-ID]")
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[EMAIL]");
  }

  // ---------- document model ----------
  function build(proc, ver) {
    const W = WF();
    const get = (v) => (W ? W.steps(proc.id, v) : clone(proc[v] || []));
    const cur = get("current");
    const fut = get("future");
    const steps = ver === "future" ? fut : cur;
    const edited = W ? W.isEdited(proc.id, ver) : false;
    const mC = W ? W.metrics(proc, cur) : null;
    const mF = W ? W.metrics(proc, fut) : null;
    const lanes = proc.lanes;
    const laneOf = (id) => lanes.find((l) => l.id === id) || lanes[0];
    const act = steps.filter(isActive);
    const asOf = (OPS.data && OPS.data.meta && OPS.data.meta.asOf) || "2026-10-18";
    const effective = addDays(asOf, 15);
    const owner = proc.owner;

    // procedure
    const procSteps = act.map((s, i) => {
      const lane = laneOf(s.lane);
      const ext = lane.kind === "external";
      let timing;
      const waitTxt = s.waitHrs ? "typical wait " + fmtWait(s.waitHrs, true).toLowerCase() : "no wait";
      if (ext) timing = "External; " + waitTxt;
      else if (ver === "future") timing = "SLA: start " + slaText(s.waitHrs) + " of the handoff; about " + fmtMin(s.touchMin) + " hands-on";
      else timing = cap(waitTxt) + " today; about " + fmtMin(s.touchMin) + " hands-on; no SLA set";
      if (s.parallel && i > 0) timing = "Runs alongside step " + i + ". " + timing;
      return {
        n: i + 1, s, lane, ext, role: lane.name, name: s.name, system: s.system || "None", timing,
        sla: ext ? "External" : cap(slaText(s.waitHrs)),
        control: controlText(s, ver, lane),
        detail: ver === "future" ? s.rationale || s.note || "" : s.note || "",
      };
    });

    // RACI
    const raci = procSteps.map((p, i) => {
      const cells = {};
      lanes.forEach((l) => (cells[l.id] = ""));
      const add = (id, letter) => { if (id && cells[id] != null && !cells[id]) cells[id] = letter; };
      cells[p.s.lane] = p.s.lane === proc.ownerLane ? "A/R" : "R";
      add(proc.ownerLane, "A");
      const prev = procSteps[i - 1], next = procSteps[i + 1];
      if (prev && prev.s.lane !== p.s.lane) add(prev.s.lane, "C");
      if (next && next.s.lane !== p.s.lane) add(next.s.lane, "I");
      return { n: p.n, name: p.name, cells };
    });

    // systems (consolidated to the platforms people actually request access to)
    const sysMap = {};
    procSteps.forEach((p) => {
      String(p.system || "").split(/,\s*/).map((x) => x.trim()).filter((x) => x && !/^(none|phone|contract)$/i.test(x)).forEach((x) => {
        const k = canonSystem(x);
        const e = (sysMap[k] = sysMap[k] || { system: k, lanes: [], steps: [] });
        if (e.lanes.indexOf(p.role) < 0) e.lanes.push(p.role);
        if (e.steps.indexOf(p.n) < 0) e.steps.push(p.n);
      });
    });
    const systems = Object.keys(sysMap).map((k) => sysMap[k]);
    const hasAI = act.some((s) => s.change === "AI-assisted");
    const hasAuto = act.some((s) => s.change === "Automated" || s.change === "Human-in-the-loop");
    const prereqs = [
      "HIPAA privacy and security training completed within the last 12 months.",
      "Role-based access to the systems listed below, at the least privilege the step needs.",
    ];
    if (ver === "future" && hasAuto) prereqs.push("Access to the exception report or review queue for each automated step you own.");
    if (ver === "future" && hasAI) prereqs.push("AI tools used only through the company workspace covered by a BAA. No personal AI accounts for any member data.");
    prereqs.push("Read this SOP and the quick-reference card, and pass the competency check (4 of 5).");

    // exceptions / PHI
    const exceptions = (proc.exceptions || []).filter((e) => !e.only || e.only === ver);
    const phiBase = [
      "Minimum necessary: open, copy, or share only the member fields the task needs.",
      "No PHI in chat, email, personal texts, or tickets. Link to the record in the approved system instead.",
      "PHI may be stored only in: " + (proc.phiStores || []).join("; ") + ".",
      "No personal devices, personal cloud drives, or personal AI accounts for member data. AI tools run only inside the BAA-covered workspace.",
      "Report a suspected disclosure to the Privacy Officer the same day.",
    ];
    const gaps = ver === "current" ? cur.filter((s) => s.phiGap).map((s) => ({ n: cur.filter(isActive).indexOf(s) + 1, text: s.phiGap })) : [];

    // KPIs
    const kpis = [];
    if (mC && mF) {
      kpis.push({ name: "Lead time (" + proc.leadLabel + ")", today: fmtLead(mC.lead), target: fmtLead(mF.lead), source: "Workflow Mapper, monthly" });
      kpis.push({ name: "Labor hours per month", today: UI.fmt.num(mC.labor) + " hrs", target: UI.fmt.num(mF.labor) + " hrs", source: "System logs plus time study, monthly" });
    }
    (proc.kpis || []).forEach((k) => kpis.push(k));

    // revision log
    const revisions = [
      { v: "0.1", date: asOf, author: AUTHOR, change: "Generated from the Workflow Mapper " + ver + " state (" + act.length + " steps" + (edited ? ", includes local map edits" : "") + ")." },
      { v: "0.2", date: "Pending", author: owner, change: "Review with frontline leads: confirm SLAs, control points, and exceptions." },
      ver === "future"
        ? { v: "1.0", date: effective, author: owner, change: "Approved for go-live after training is complete for every affected role." }
        : { v: "1.0", date: "Pending", author: owner, change: "Baseline approved as the starting point for the redesign." },
    ];

    // what changes for you
    const changes = changesFor(proc, cur, fut, mC, mF, laneOf);

    // training plan
    const saved = mC && mF ? Math.max(0, mC.labor - mF.labor) : 0;
    const training = trainingPlan(proc, ver, changes, fut, laneOf);
    const trainHrs = training.reduce((s, r) => s + r.hours, 0);
    const people = training.reduce((s, r) => s + r.people, 0);
    // payback assumes only half the savings show up in month one while adoption ramps
    const paybackDays = saved > 0 ? trainHrs / ((saved * 0.5) / 21) : null;

    const model = {
      proc, ver, steps, act, cur, fut, edited, mC, mF, laneOf, owner, effective, asOf,
      meta: {
        id: "SOP-" + proc.code + "-01",
        version: ver === "future" ? "1.0 draft (future state)" : "0.9 (current state, as-is)",
        status: "Draft for review",
        owner,
        effective: ver === "future" ? effective : "Not for go-live",
        review: "Quarterly, or after any system change",
      },
      procSteps, raci, systems, prereqs, exceptions, phiBase, gaps, kpis, revisions, changes, training, trainHrs, people, saved, paybackDays,
    };
    model.quiz = buildQuiz(model);
    return model;
  }

  const SYSTEM_RULES = [
    [/claude/i, "Claude (BAA-covered workspace)"],
    [/crm|language flag/i, "CRM"],
    [/dialer/i, "Dialer"],
    [/scheduling (system|api)/i, "Scheduling system"],
    [/sms/i, "SMS platform"],
    [/risk score/i, "No-show risk model"],
    [/n8n|scheduled job|validation job|python job/i, "Automation jobs (n8n)"],
    [/clinician (mobile )?app/i, "Clinician mobile app"],
    [/ehr/i, "EHR"],
    [/clearinghouse/i, "Clearinghouse"],
    [/excel|spreadsheet/i, "Excel and shared spreadsheets"],
    [/email/i, "Email"],
    [/sftp/i, "SFTP"],
    [/sql|canonical schema/i, "SQL data platform"],
    [/review queue/i, "Review queue"],
    [/project tracker|zapier/i, "Project tracker and Zapier"],
  ];
  function canonSystem(x) {
    const hit = SYSTEM_RULES.find((r) => r[0].test(x));
    return hit ? hit[1] : cap(x);
  }

  function controlText(s, ver, lane) {
    if (s.control) return s.control;
    if (lane.kind === "external") return s.decision ? "Record the answer with a disposition code before the next step." : "Track receipt and timeliness; escalate late or malformed items to the named contact.";
    if (ver === "future") {
      if (s.change === "AI-assisted") return "Review every AI draft before it is saved; low-confidence drafts route to QA review.";
      if (s.change === "Human-in-the-loop") return "Approve or override each queued item; every override is logged with a reason.";
      if (s.change === "Automated") return "Check the exception report every morning; failed items are worked by hand the same day.";
    }
    if (s.decision) return "Record the outcome with a reason code before moving on.";
    if ((s.reworkPct || 0) >= 0.05) return "Log a reason code for every redo; target under " + UI.fmt.pct(Math.max(0.01, s.reworkPct / 2), 0) + " rework.";
    if (s.handoff) return "Confirm the item is in " + String(s.system || "the system").split(/,\s*/)[0] + " before closing your task.";
    return "Complete every required field before moving on.";
  }

  function changesFor(proc, cur, fut, mC, mF, laneOf) {
    const byLane = {};
    proc.lanes.filter((l) => l.kind === "internal").forEach((l) => (byLane[l.id] = { lane: l, items: [], same: [], freed: 0 }));
    const push = (laneId, item) => { if (byLane[laneId]) byLane[laneId].items.push(item); };
    const facts = (s) => fmtMin(s.touchMin) + " hands-on, " + (s.waitHrs ? "typical wait " + fmtWait(s.waitHrs, true).toLowerCase() : "no wait");
    fut.forEach((f) => {
      const c = f.from ? cur.find((x) => x.id === f.from) : null;
      if (!c) {
        push(f.lane, { kind: f.change === "Unchanged" ? "New" : f.change, old: "Not part of the process today.", neu: f.name + ". " + (f.rationale || ""), oldFacts: "", newFacts: facts(f) });
        return;
      }
      if (f.change === "Eliminated") {
        push(c.lane, { kind: "Eliminated", old: c.name, neu: "You no longer do this. " + (f.rationale || ""), oldFacts: facts(c), newFacts: "" });
        return;
      }
      const same = f.change === "Unchanged" && f.name === c.name && f.volumePerMonth === c.volumePerMonth && f.pathPct === c.pathPct && f.lane === c.lane && f.touchMin === c.touchMin && f.waitHrs === c.waitHrs && f.system === c.system;
      if (same) { if (byLane[c.lane]) byLane[c.lane].same.push(c.name); return; }
      const moved = f.lane !== c.lane;
      push(c.lane, { kind: moved ? "Moves" : f.change === "Unchanged" ? "Adjusted" : f.change, old: c.name, neu: (moved ? "Moves to " + laneOf(f.lane).name + ": " : "") + f.name + ". " + (f.rationale || ""), oldFacts: facts(c), newFacts: facts(f) });
      if (moved) push(f.lane, { kind: "New", old: "Done by " + laneOf(c.lane).name + " today.", neu: f.name + ". " + (f.rationale || ""), oldFacts: facts(c), newFacts: facts(f) });
    });
    cur.forEach((c) => {
      if (!fut.some((f) => f.from === c.id)) push(c.lane, { kind: "Eliminated", old: c.name, neu: "Removed from the process in the redesign.", oldFacts: facts(c), newFacts: "" });
    });
    Object.keys(byLane).forEach((k) => {
      const e = byLane[k];
      e.freed = mC && mF ? (mC.laborByLane[k] || 0) - (mF.laborByLane[k] || 0) : 0;
    });
    return Object.keys(byLane).map((k) => byLane[k]).filter((e) => e.items.length || e.same.length);
  }

  function trainingPlan(proc, ver, changes, fut, laneOf) {
    const rows = [];
    changes.forEach((e) => {
      const lane = e.lane;
      const kinds = e.items.map((i) => i.kind);
      const futKinds = fut.filter((f) => f.lane === lane.id && isActive(f)).map((f) => f.change);
      const all = kinds.concat(futKinds);
      let format, mins, timing;
      if (ver === "current") { format = "Shadow a tenured teammate for two shifts, then read this SOP and the quick-reference card"; mins = 120; timing = "First week after hire"; }
      else if (all.indexOf("AI-assisted") >= 0) { format = "Hands-on lab with de-identified examples: review, correct, and confirm AI drafts; then a supervised first shift"; mins = 90; timing = "Week before go-live"; }
      else if (all.indexOf("Human-in-the-loop") >= 0) { format = "Walkthrough of the review queue with de-identified examples, including when to override and how it is logged"; mins = 60; timing = "Week before go-live"; }
      else if (all.indexOf("Automated") >= 0 || all.indexOf("Eliminated") >= 0 || all.indexOf("Moves") >= 0 || all.indexOf("New") >= 0) { format = "Team-meeting briefing: what the system now does, what you stop doing, how to work exceptions"; mins = 30; timing = "Go-live week"; }
      else { format = "Read the SOP and sign the acknowledgement"; mins = 15; timing = "Before go-live"; }
      const people = Math.max(1, lane.headcount || 1);
      rows.push({ audience: lane.name, people, format, mins, timing, owner: lane.lead, hours: (people * mins) / 60 });
    });
    if (ver === "future" && rows.length) {
      const supers = changes.reduce((s, e) => s + Math.max(1, Math.ceil((e.lane.headcount || 1) / 10)), 0);
      rows.push({ audience: "Super-users (1 per 10 staff)", people: supers, format: "Train-the-trainer session, then floor support for the first two weeks", mins: 120, timing: "Two weeks before go-live", owner: proc.owner, hours: (supers * 120) / 60 });
    }
    return rows;
  }

  function buildQuiz(model) {
    const { proc, ver, procSteps } = model;
    const r = rng(proc.id + ":" + ver + ":" + procSteps.length);
    const internal = procSteps.filter((p) => !p.ext);
    const used = {};
    const m = ver === "future" ? model.mF : model.mC;
    const labor = (p) => (m && m.per[p.s.id] ? m.per[p.s.id].labor : 0);
    const pick = (list) => { const x = list.find((p) => !used[p.s.id]); if (x) used[x.s.id] = true; return x; };
    const qs = [];
    const mk = (q, correct, wrong, why) => {
      const seen = {};
      const opts = [correct].concat(wrong).filter((o) => { const k = String(o).toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 4);
      const order = shuffle(opts, r);
      qs.push({ q, options: order, answer: order.indexOf(correct), why });
    };
    const quote = (p) => "step " + p.n + ", “" + p.name + "”";

    // 1. system
    const p1 = pick(internal.slice().sort((a, b) => labor(b) - labor(a)));
    if (p1) {
      const pool = [];
      model.cur.concat(model.fut).forEach((s) => { if (s.system && s.system !== p1.system && !/^none$/i.test(s.system) && pool.indexOf(s.system) < 0) pool.push(s.system); });
      const wrong = shuffle(pool, r).slice(0, 2).concat(["Email and a shared spreadsheet"]);
      mk("Which system do you use for " + quote(p1) + "?", p1.system, wrong, "Step " + p1.n + " is done in " + p1.system + ".");
    }
    // 2. role on a handoff step
    const p2 = pick(internal.filter((p) => p.s.handoff).concat(internal));
    if (p2) {
      const others = proc.lanes.map((l) => l.name).filter((n) => n !== p2.role);
      const wrong = shuffle(others, r).slice(0, 3);
      while (wrong.length < 3) wrong.push(["Process owner (" + proc.owner + ")", "Whoever is free", "The health plan"][wrong.length]);
      const prev = procSteps[p2.n - 2];
      mk("Who is responsible for " + quote(p2) + "?", p2.role, wrong, p2.role + " owns step " + p2.n + (prev && prev.role !== p2.role ? "; the work arrives as a handoff from " + prev.role + "." : "."));
    }
    // 3. SLA or typical wait
    const p3 = pick(internal.filter((p) => p.s.waitHrs > 0).sort((a, b) => b.s.waitHrs - a.s.waitHrs).concat(internal));
    if (p3) {
      if (ver === "future") {
        const ladder = ["Immediately", "Within 1 hour", "Within 4 business hours", "The same business day", "Within 1 business day", "Within 2 business days", "Within 3 business days", "Within 5 calendar days", "Within 10 calendar days"];
        const correct = cap(slaText(p3.s.waitHrs));
        const wrong = shuffle(ladder.filter((x) => x !== correct), r).slice(0, 3);
        mk("What is the SLA to start " + quote(p3) + " once it reaches you?", correct, wrong, "The SOP sets this SLA from the redesigned wait time for the step.");
      } else {
        const correct = cap(fmtWait(p3.s.waitHrs, true));
        const alts = [p3.s.waitHrs / 4, p3.s.waitHrs * 2, Math.max(1, p3.s.waitHrs / 12)].map((h) => cap(fmtWait(Math.round(h), true)));
        mk("How long does work typically wait before " + quote(p3) + " today?", correct, alts, "This is the typical wait measured today; the redesign replaces it with an SLA.");
      }
    }
    // 4. control point
    const ctrlFirst = internal.filter((p) => p.s.change === "AI-assisted" || p.s.change === "Human-in-the-loop").concat(internal.filter((p) => (p.s.reworkPct || 0) >= 0.05)).concat(internal);
    const p4 = pick(ctrlFirst);
    if (p4) {
      const otherCtrl = internal.map((p) => p.control).filter((c) => c !== p4.control);
      const wrong = [otherCtrl[0] || "Forward the item to your manager by email for approval.", "Skip the check when the queue is long and catch up at month end.", "No check is needed; the next team will catch any errors."];
      mk("What is the control point at " + quote(p4) + "?", p4.control, wrong, "This control stops errors and unreviewed drafts from moving downstream.");
    }
    // 5. PHI
    const store = proc.phiShare || (proc.phiStores && proc.phiStores[0]) || "the approved system";
    mk("A member's case needs another team's help. How do you share the details?",
      cap("use " + store + ", with only the fields they need"),
      ["Email the member list so there is a written record", "Post the details in the team chat so it gets resolved faster", "Ask a personal AI chatbot to summarize the case first"],
      "Minimum necessary, inside an approved system with access control and an audit trail.");
    return qs;
  }

  // ---------- Markdown exports ----------
  function mdTable(head, rows) {
    return "| " + head.map(mdCell).join(" | ") + " |\n|" + head.map(() => "---").join("|") + "|\n" + rows.map((r) => "| " + r.map(mdCell).join(" | ") + " |").join("\n");
  }
  function sopMarkdown(md) {
    const p = md.proc;
    const L = [];
    L.push("# " + md.meta.id + ": " + p.name);
    L.push("**Version:** " + md.meta.version + " · **Status:** " + md.meta.status + " · **Owner:** " + md.meta.owner + " · **Effective:** " + md.meta.effective + " · **Review:** " + md.meta.review);
    L.push("**Starts when:** " + p.trigger + ". **Done when:** " + p.outcome + ".");
    L.push("## 1. Purpose\n" + p.purpose);
    L.push("## 2. Scope\n**In scope**\n" + p.scope.in.map((x) => "- " + x).join("\n") + "\n\n**Out of scope**\n" + p.scope.out.map((x) => "- " + x).join("\n"));
    L.push("## 3. Roles and RACI\n" + mdTable(["Step"].concat(p.lanes.map((l) => l.name)), md.raci.map((r) => [r.n + ". " + r.name].concat(p.lanes.map((l) => r.cells[l.id] || "")))) + "\n\nR = responsible, A = accountable, C = consulted, I = informed. Accountable owner: " + md.owner + ".");
    L.push("## 4. Prerequisites and systems access\n" + md.prereqs.map((x) => "- " + x).join("\n") + "\n\n" + mdTable(["System", "Used by", "Steps"], md.systems.map((s) => [s.system, s.lanes.join(", "), s.steps.join(", ")])));
    L.push("## 5. Procedure\n" + md.procSteps.map((s) => s.n + ". **[" + s.role + "] " + s.name + "**  \n   System: " + s.system + ". " + s.timing + ".  \n   Control point: " + s.control + (s.detail ? "  \n   " + s.detail : "")).join("\n"));
    L.push("## 6. Exceptions and escalation\n" + mdTable(["When", "Do this", "Owner", "Within"], md.exceptions.map((e) => [e.when, e.then, e.owner, e.within])));
    let phi = "## 7. PHI handling\n" + md.phiBase.concat(p.phi || []).map((x) => "- " + x).join("\n");
    if (md.gaps.length) phi += "\n\n**Known gaps in the current process (fixed in the future state)**\n" + md.gaps.map((g) => "- Step " + g.n + ": " + g.text).join("\n");
    L.push(phi);
    L.push("## 8. KPIs\n" + mdTable(["KPI", "Today", "Target", "Source"], md.kpis.map((k) => [k.name, k.today, k.target, k.source])));
    L.push("## 9. Revision log\n" + mdTable(["Version", "Date", "Author", "Change"], md.revisions.map((r) => [r.v, r.date, r.author, r.change])));
    return L.join("\n\n") + "\n";
  }
  function qrcData(md) {
    const ctrls = [];
    md.procSteps.forEach((s) => { if (!s.ext && ctrls.length < 3 && ctrls.every((c) => c.text !== s.control) && (s.s.change && s.s.change !== "Unchanged" || (s.s.reworkPct || 0) >= 0.05 || s.s.decision)) ctrls.push({ n: s.n, text: s.control }); });
    md.procSteps.forEach((s) => { if (!s.ext && ctrls.length < 3 && ctrls.every((c) => c.text !== s.control)) ctrls.push({ n: s.n, text: s.control }); });
    return {
      ctrls,
      esc: md.exceptions.slice(0, 3),
      never: ["Email, chat, or text member details. Link to the record instead.", "Save member data on a laptop, personal drive, or personal AI tool.", "Share more fields than the task needs."],
      measure: md.kpis.slice(0, 3),
    };
  }
  function qrcMarkdown(md) {
    const p = md.proc, q = qrcData(md);
    const L = [];
    L.push("# " + p.short + ": quick reference (" + (md.ver === "future" ? "future state" : "current state") + ")");
    L.push("**Starts when:** " + p.trigger + ". **Done when:** " + p.outcome + ". **Owner:** " + md.owner + ".");
    L.push(mdTable(["#", "Who", "Do", "In", md.ver === "future" ? "Start" : "Typical wait"], md.procSteps.map((s) => [s.n, s.role, s.name, s.system, md.ver === "future" ? s.sla : cap(fmtWait(s.s.waitHrs, true))])));
    L.push("**Check before you move on**\n" + q.ctrls.map((c) => "- Step " + c.n + ": " + c.text).join("\n"));
    L.push("**Escalate**\n" + q.esc.map((e) => "- " + e.when + ": " + e.owner + ", " + e.within.toLowerCase()).join("\n"));
    L.push("**PHI: never**\n" + q.never.map((x) => "- " + x).join("\n"));
    L.push("**We measure**\n" + q.measure.map((k) => "- " + k.name + ": target " + k.target).join("\n"));
    return L.join("\n\n") + "\n";
  }
  function quizMarkdown(md) {
    const L = ["# " + md.proc.short + ": competency check (" + (md.ver === "future" ? "future state" : "current state") + ")", "Pass mark: 4 of 5."];
    md.quiz.forEach((q, i) => { L.push((i + 1) + ". " + q.q + "\n" + q.options.map((o, j) => "   " + "ABCD"[j] + ". " + o).join("\n")); });
    L.push("## Answer key\n" + md.quiz.map((q, i) => (i + 1) + ". " + "ABCD"[q.answer] + " (" + q.options[q.answer] + "). " + q.why).join("\n"));
    return L.join("\n\n") + "\n";
  }

  // ---------- CSS ----------
  UI.style("sop", `
    .sop-controls { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: flex-end; }
    .sop-controls > .field { flex: 1 1 280px; max-width: 440px; }
    .sop-verfield { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .sop-verfield > span { font-size: var(--fs-sm); color: var(--ink-2); font-weight: 500; }
    .sop-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .sop-tabs { align-self: flex-start; }
    .sop-doc { gap: 24px; padding: 26px 28px; }
    .sop-dochead { display: flex; flex-direction: column; gap: 10px; padding-bottom: 16px; border-bottom: 2px solid var(--ink); }
    .sop-dochead h2 { font-size: var(--fs-2xl); }
    .sop-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px 18px; margin: 0; }
    .sop-meta dt { font-size: var(--fs-xs); color: var(--ink-3); }
    .sop-meta dd { margin: 0; font-size: var(--fs-sm); font-weight: 600; }
    .sop-sec { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .sop-sec > h3 { font-size: var(--fs-lg); padding-bottom: 6px; border-bottom: 1px solid var(--line); }
    .sop-sec p, .sop-sec li { font-size: var(--fs-sm); line-height: 1.6; max-width: 84ch; }
    .sop-sec ul { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
    .sop-scope { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .sop-scope > div { background: var(--surface-2); border-radius: var(--r-md); padding: 10px 12px; min-width: 0; }
    .sop-proc { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .sop-proc > li { display: grid; grid-template-columns: 2em minmax(0, 1fr); gap: 4px 12px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-md); max-width: none; }
    .sop-proc > li.is-ext { border-style: dashed; }
    .sop-n { font-family: var(--font-mono); font-weight: 600; font-size: var(--fs-xs); width: 2em; height: 2em; border-radius: 50%; background: var(--surface-3); color: var(--ink); display: grid; place-items: center; }
    .sop-step-title { font-weight: 600; font-size: var(--fs-sm); }
    .sop-step-title .sop-role { font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-3); margin-right: 6px; }
    .sop-step-meta { display: flex; flex-wrap: wrap; gap: 2px 16px; font-size: var(--fs-xs); color: var(--ink-2); }
    .sop-ctrl { font-size: var(--fs-xs); background: var(--accent-soft); color: var(--ink); border-radius: var(--r-sm); padding: 4px 8px; justify-self: start; }
    .sop-ctrl b { font-weight: 600; }
    .sop-detail { font-size: var(--fs-xs); color: var(--ink-3); }
    .sop-raci td, .sop-raci th { text-align: center; }
    .sop-raci td:first-child, .sop-raci th:first-child { text-align: left; min-width: 15em; }
    .sop-raci td.sop-r { font-family: var(--font-mono); font-weight: 700; }
    .sop-raci td.sop-r.R { background: var(--accent-soft); }
    .sop-raci td.sop-r.A { background: var(--surface-3); }
    .sop-gaps { border-left: 4px solid var(--warning); }
    .sop-roles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .sop-chg { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 6px 10px; align-items: start; padding: 10px 0; border-top: 1px solid var(--line); }
    .sop-chg:first-of-type { border-top: 0; }
    .sop-chg .sop-old { color: var(--ink-2); font-size: var(--fs-sm); }
    .sop-chg .sop-new { font-size: var(--fs-sm); }
    .sop-chg .sop-arrow { color: var(--ink-3); padding-top: 2px; }
    .sop-chg .sop-arrow svg { width: 16px; height: 16px; }
    .sop-chg small { display: block; color: var(--ink-3); font-size: var(--fs-xs); margin-top: 2px; }
    .sop-kind { grid-column: 1 / -1; }
    .sop-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 0.6875rem; font-weight: 600; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
    .sop-badge.auto { background: var(--good-soft); color: var(--good-ink); }
    .sop-badge.ai { background: var(--accent-soft); color: var(--accent); }
    .sop-badge.hitl { background: var(--warning-soft); color: var(--warning-ink); }
    .sop-badge.elim { background: var(--critical-soft); color: var(--critical-ink); }
    .sop-badge.move, .sop-badge.new, .sop-badge.same { background: var(--surface-2); color: var(--ink-2); }
    .sop-qrc { border: 2px solid var(--ink); border-radius: var(--r-lg); padding: 20px 22px; background: var(--surface); display: flex; flex-direction: column; gap: 16px; max-width: 1040px; }
    .sop-qrc-head { display: flex; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; align-items: baseline; border-bottom: 1px solid var(--line); padding-bottom: 10px; }
    .sop-qrc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 22px; }
    .sop-qrc-grid h4 { font-size: var(--fs-sm); margin-bottom: 4px; }
    .sop-qrc-grid ul { margin: 0; padding-left: 18px; font-size: var(--fs-sm); display: flex; flex-direction: column; gap: 3px; }
    .sop-quiz { display: flex; flex-direction: column; gap: 14px; }
    .sop-q { border: 1px solid var(--line); border-radius: var(--r-md); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .sop-q-text { font-weight: 600; font-size: var(--fs-sm); }
    .sop-opts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    .sop-opt { font: inherit; font-size: var(--fs-sm); text-align: left; padding: 7px 10px; border-radius: var(--r-md); border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); cursor: pointer; display: flex; gap: 8px; align-items: flex-start; min-width: 0; }
    .sop-opt:hover { background: var(--surface-2); }
    .sop-opt .sop-letter { font-family: var(--font-mono); font-weight: 600; color: var(--ink-3); flex: none; }
    .sop-opt.is-right { border-color: var(--good); background: var(--good-soft); }
    .sop-opt.is-wrong { border-color: var(--critical); background: var(--critical-soft); }
    .sop-opt[aria-pressed="true"] { box-shadow: inset 0 0 0 1px var(--ink-2); }
    .sop-why { font-size: var(--fs-xs); color: var(--ink-2); }
    .sop-ai-out { max-height: 520px; }
    @media (max-width: 900px) { .sop-roles, .sop-qrc-grid { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 560px) {
      .sop-doc { padding: 16px 14px; }
      .sop-scope, .sop-opts { grid-template-columns: minmax(0, 1fr); }
      .sop-chg { grid-template-columns: minmax(0, 1fr); }
      .sop-chg .sop-arrow { transform: rotate(90deg); justify-self: start; }
      .sop-qrc { padding: 14px; }
    }
  `);

  // ---------- state & render ----------
  let st = null;
  let els = {};
  let model = null;
  let runToken = 0;

  function render(root, ctx) {
    const procs = Array.isArray(OPS.processes) ? OPS.processes : [];
    if (!procs.length) {
      root.innerHTML = `<div class="empty">No process library is loaded yet. The SOP builder reads its processes from the <a href="#workflow">Workflow Mapper</a>; open that page once it is available.</div>
        <div class="presenter-note">The SOP builder generates documents from the mapped processes. Once a process is mapped, the procedure, training plan, and quiz follow from it.</div>`;
      return;
    }
    const byId = {};
    procs.forEach((p) => (byId[p.id] = p));
    const saved = UI.store.get("sop.ui", {}) || {};
    const prm = ctx.params || {};
    const prev = st;
    st = {
      pid: byId[prm.process] ? prm.process : prev && byId[prev.pid] ? prev.pid : byId[saved.pid] ? saved.pid : procs[0].id,
      ver: VERS.some((v) => v.value === prm.version) ? prm.version : prev ? prev.ver : "future",
      tab: TABS.some((t) => t.value === prm.tab) ? prm.tab : prev ? prev.tab : TABS.some((t) => t.value === saved.tab) ? saved.tab : "sop",
      answers: {},
      reveal: false,
      byId,
    };
    runToken++;

    root.innerHTML = `
      <div class="panel">
        <div class="sop-controls">
          ${UI.select("sop-proc", procs.map((p) => ({ value: p.id, label: p.name })), st.pid, "Process")}
          <div class="sop-verfield"><span id="sop-ver-label">Version</span>${UI.seg("sop-ver", VERS, st.ver)}</div>
        </div>
        <div class="sop-actions">
          <button type="button" class="btn primary" data-act="copy-sop">${UI.icon("copy")}<span>Copy SOP as Markdown</span></button>
          <button type="button" class="btn" data-act="copy-qrc">${UI.icon("copy")}<span>Copy quick-reference card</span></button>
          <button type="button" class="btn" data-act="copy-quiz">${UI.icon("copy")}<span>Copy quiz</span></button>
          <span id="sop-ai-slot"></span>
          <button type="button" class="btn ghost" data-act="open-map">${UI.icon("flow")}<span>Open this map</span></button>
        </div>
        <div id="sop-note"></div>
      </div>
      <div class="presenter-note">Documentation ships with the change. The SOP, the quick-reference card, and the quiz all come from the same process map, so when the process changes the training changes with it, and nobody maintains three documents by hand.</div>
      <div class="grid g-4" id="sop-kpis"></div>
      <div id="sop-ai"></div>
      <div class="stack" style="gap:14px">
        ${UI.seg("sop-tab", TABS, st.tab).replace('class="seg"', 'class="seg sop-tabs"')}
        <div id="sop-body"></div>
      </div>`;
    els = {
      root,
      note: root.querySelector("#sop-note"),
      kpis: root.querySelector("#sop-kpis"),
      body: root.querySelector("#sop-body"),
      ai: root.querySelector("#sop-ai"),
      aiSlot: root.querySelector("#sop-ai-slot"),
    };
    const vs = root.querySelector("#sop-ver");
    if (vs) vs.setAttribute("aria-labelledby", "sop-ver-label");
    const ts = root.querySelector("#sop-tab");
    if (ts) ts.setAttribute("aria-label", "Document sections");

    root.querySelector("#sop-proc").addEventListener("change", (e) => { st.pid = e.target.value; st.answers = {}; st.reveal = false; persist(); refresh(); });
    UI.wireSeg(root, "sop-ver", (v) => { st.ver = v; st.answers = {}; st.reveal = false; refresh(); });
    UI.wireSeg(root, "sop-tab", (v) => { st.tab = v; persist(); renderBody(); });
    UI.on(root, "click", "[data-act]", (e, el) => onAction(el.dataset.act, el, e));

    refresh();

    // live Claude rewrite: only offered when the viewer actually has it
    const token = runToken;
    Promise.resolve(OPS.ai && OPS.ai.available ? OPS.ai.available() : false).then((ok) => {
      if (!ok || token !== runToken || !els.aiSlot || !els.aiSlot.isConnected) return;
      els.aiSlot.innerHTML = `<button type="button" class="btn" data-act="ai">${UI.icon("spark")}<span>Tighten with Claude</span></button>`;
    }).catch(() => {});
  }

  function persist() { UI.store.set("sop.ui", { pid: st.pid, tab: st.tab }); }

  function refresh() {
    model = build(st.byId[st.pid], st.ver);
    renderNote();
    renderKpis();
    renderBody();
  }

  function renderNote() {
    const m = model;
    const wfEdited = m.edited;
    els.note.innerHTML = wfEdited
      ? `<div class="callout accent"><div><strong>Built from your edited ${m.ver === "future" ? "future" : "current"}-state map.</strong> Steps and timings follow the changes you made in the Workflow Mapper. <a href="#workflow" data-act="open-map">Open the map</a></div></div>`
      : `<p class="xs muted">Generated from the ${UI.esc(m.proc.name.toLowerCase())} ${m.ver === "future" ? "future-state" : "current-state"} map. Edit the map in the Workflow Mapper and these documents follow. Example content: confirm with the process owner before use.</p>`;
  }

  function renderKpis() {
    const m = model;
    const changed = m.act.filter((s) => s.change && s.change !== "Unchanged").length;
    const auto = m.act.filter((s) => s.change === "Automated" || s.change === "AI-assisted" || s.change === "Human-in-the-loop").length;
    const internalLanes = m.proc.lanes.filter((l) => l.kind === "internal").length;
    const affected = m.changes.filter((c) => c.items.length).length;
    const fewer = m.cur.filter(isActive).length - m.fut.filter(isActive).length;
    const tiles = [
      { label: "Procedure steps", value: String(m.act.length), foot: m.ver === "future" ? auto + " automated, AI-assisted, or reviewed" : m.act.filter((s) => s.manual).length + " manual today" },
      { label: "Roles affected by the redesign", value: affected + " of " + internalLanes, foot: (fewer > 0 ? fewer + (fewer === 1 ? " fewer step; " : " fewer steps; ") : "") + changed + " changed in the future state" },
      { label: "Training time", value: UI.fmt.num(m.trainHrs), unit: "hrs", foot: UI.fmt.num(m.people) + " people across " + m.training.length + " sessions" },
      m.ver === "future" && m.paybackDays != null
        ? { label: "Training pays back in", value: UI.fmt.dec(Math.max(0.1, m.paybackDays), 1), unit: "working days", foot: UI.fmt.num(m.saved) + " hrs/month freed, at 50% adoption in month one" }
        : { label: "Hours freed by the redesign", value: UI.fmt.num(m.saved), unit: "hrs/mo", foot: "current minus future labor hours" },
    ];
    els.kpis.innerHTML = tiles.map(UI.kpi).join("");
  }

  function renderBody() {
    if (!model) return;
    if (st.tab === "changes") els.body.innerHTML = changesHtml(model);
    else if (st.tab === "qrc") els.body.innerHTML = qrcHtml(model);
    else if (st.tab === "training") els.body.innerHTML = trainingHtml(model);
    else els.body.innerHTML = sopHtml(model);
  }

  // ---------- SOP document ----------
  function sopHtml(m) {
    const p = m.proc;
    const meta = m.meta;
    const raciHead = `<tr><th>Step</th>${p.lanes.map((l) => `<th>${UI.esc(l.name)}</th>`).join("")}</tr>`;
    const raciRows = m.raci.map((r) => `<tr><td>${r.n}. ${UI.esc(r.name)}</td>${p.lanes.map((l) => { const v = r.cells[l.id] || ""; const k = v.indexOf("R") >= 0 ? "R" : v === "A" ? "A" : ""; return `<td class="sop-r ${k}">${UI.esc(v)}</td>`; }).join("")}</tr>`).join("");
    return `<article class="panel sop-doc" aria-label="Standard operating procedure">
      <header class="sop-dochead">
        <div class="label">Standard operating procedure · ${UI.esc(meta.id)}</div>
        <h2>${UI.esc(p.name)}</h2>
        <dl class="sop-meta">
          <div><dt>Version</dt><dd>${UI.esc(meta.version)}</dd></div>
          <div><dt>Status</dt><dd>${UI.pill("warning", meta.status)}</dd></div>
          <div><dt>Process owner</dt><dd>${UI.esc(meta.owner)}</dd></div>
          <div><dt>Effective</dt><dd>${UI.esc(meta.effective)}</dd></div>
          <div><dt>Review cycle</dt><dd>${UI.esc(meta.review)}</dd></div>
        </dl>
        <p class="small"><strong>Starts when:</strong> ${UI.esc(p.trigger)}. <strong>Done when:</strong> ${UI.esc(p.outcome)}.</p>
      </header>
      <section class="sop-sec"><h3>1. Purpose</h3><p>${UI.esc(p.purpose)}</p></section>
      <section class="sop-sec"><h3>2. Scope</h3>
        <div class="sop-scope">
          <div><div class="label">In scope</div><ul>${p.scope.in.map((x) => `<li>${UI.esc(x)}</li>`).join("")}</ul></div>
          <div><div class="label">Out of scope</div><ul>${p.scope.out.map((x) => `<li>${UI.esc(x)}</li>`).join("")}</ul></div>
        </div>
      </section>
      <section class="sop-sec"><h3>3. Roles and RACI</h3>
        <div class="table-wrap"><table class="data sop-raci"><thead>${raciHead}</thead><tbody>${raciRows}</tbody></table></div>
        <p class="xs muted">R responsible · A accountable · C consulted · I informed. Accountable owner: ${UI.esc(m.owner)}.</p>
      </section>
      <section class="sop-sec"><h3>4. Prerequisites and systems access</h3>
        <ul>${m.prereqs.map((x) => `<li>${UI.esc(x)}</li>`).join("")}</ul>
        ${UI.table([{ key: "system", label: "System" }, { key: "lanes", label: "Used by", fmt: (v) => UI.esc(v.join(", ")) }, { key: "steps", label: "Steps", fmt: (v) => UI.esc(v.join(", ")) }], m.systems)}
      </section>
      <section class="sop-sec"><h3>5. Procedure</h3>
        <ol class="sop-proc">${m.procSteps.map((s) => `<li class="${s.ext ? "is-ext" : ""}">
          <span class="sop-n" aria-hidden="true">${s.n}</span>
          <div class="stack" style="gap:5px">
            <div class="sop-step-title"><span class="sop-role">${UI.esc(s.role)}</span>${UI.esc(s.name)}${m.ver === "future" && s.s.change && s.s.change !== "Unchanged" ? " " + badge(s.s.change) : ""}</div>
            <div class="sop-step-meta"><span><strong>System:</strong> ${UI.esc(s.system)}</span><span><strong>Timing:</strong> ${UI.esc(s.timing)}</span></div>
            <div class="sop-ctrl"><b>Control point:</b> ${UI.esc(s.control)}</div>
            ${s.detail ? `<div class="sop-detail">${UI.esc(s.detail)}</div>` : ""}
          </div>
        </li>`).join("")}</ol>
      </section>
      <section class="sop-sec"><h3>6. Exceptions and escalation</h3>
        ${m.exceptions.length ? UI.table([{ key: "when", label: "When" }, { key: "then", label: "Do this" }, { key: "owner", label: "Owner" }, { key: "within", label: "Within" }], m.exceptions) : `<p class="muted">No exceptions recorded.</p>`}
      </section>
      <section class="sop-sec"><h3>7. PHI handling</h3>
        <ul>${m.phiBase.concat(p.phi || []).map((x) => `<li>${UI.esc(x)}</li>`).join("")}</ul>
        ${m.gaps.length ? `<div class="callout warning sop-gaps"><div><strong>Known gaps in the current process (fixed in the future state)</strong><ul>${m.gaps.map((g) => `<li>Step ${g.n}: ${UI.esc(g.text)}</li>`).join("")}</ul></div></div>` : ""}
      </section>
      <section class="sop-sec"><h3>8. KPIs</h3>
        ${UI.table([{ key: "name", label: "KPI" }, { key: "today", label: "Today", num: true }, { key: "target", label: "Target", num: true }, { key: "source", label: "Source and cadence" }], m.kpis)}
      </section>
      <section class="sop-sec"><h3>9. Revision log</h3>
        ${UI.table([{ key: "v", label: "Version" }, { key: "date", label: "Date" }, { key: "author", label: "Author" }, { key: "change", label: "Change" }], m.revisions)}
      </section>
    </article>`;
  }
  const BADGE = { Automated: "auto", "AI-assisted": "ai", "Human-in-the-loop": "hitl", Eliminated: "elim", Moves: "move", New: "new", Adjusted: "same", Unchanged: "same" };
  const badge = (k) => `<span class="sop-badge ${BADGE[k] || "same"}">${UI.esc(k)}</span>`;

  // ---------- what changes for you ----------
  function changesHtml(m) {
    if (!m.changes.length) return `<div class="empty">The current and future maps match, so nothing changes for any role yet.</div>`;
    return `<div class="stack" style="gap:16px">
      <div class="presenter-note">People adopt what they understand. This view tells each role what is different on Monday in plain terms: the old way, the new way, and the hours it gives back to their team.</div>
      <div class="sop-roles">${m.changes.map((e) => `<section class="panel">
        <div class="panel-head"><div><h3>${UI.esc(e.lane.name)}</h3><p class="panel-sub">${UI.esc(e.lane.headcount ? e.lane.headcount + " people · " : "")}lead: ${UI.esc(e.lane.lead)}</p></div>
          ${Math.abs(e.freed) >= 1 ? UI.pill(e.freed > 0 ? "good" : "warning", (e.freed > 0 ? UI.fmt.num(e.freed) + " hrs/month freed" : UI.fmt.num(-e.freed) + " hrs/month added")) : UI.pill("neutral", "Same hours")}</div>
        ${e.items.length ? `<div>${e.items.map((it) => `<div class="sop-chg">
          <div class="sop-kind">${badge(it.kind)}</div>
          <div class="sop-old"><span class="label">Old way</span><br>${UI.esc(it.old)}${it.oldFacts ? `<small>${UI.esc(it.oldFacts)}</small>` : ""}</div>
          <div class="sop-arrow" aria-hidden="true">${UI.icon("arrow")}</div>
          <div class="sop-new"><span class="label">New way</span><br>${UI.esc(it.neu)}${it.newFacts ? `<small>${UI.esc(it.newFacts)}</small>` : ""}</div>
        </div>`).join("")}</div>` : `<p class="small muted">No changes to this role's steps.</p>`}
        ${e.same.length ? `<p class="xs muted"><strong>Stays the same:</strong> ${UI.esc(e.same.join("; "))}.</p>` : ""}
      </section>`).join("")}</div>
    </div>`;
  }

  // ---------- quick reference ----------
  function qrcHtml(m) {
    const p = m.proc, q = qrcData(m);
    const fut = m.ver === "future";
    return `<div class="sop-qrc" aria-label="Quick-reference card">
      <div class="sop-qrc-head"><div><div class="label">Quick reference · ${UI.esc(m.meta.id)} · ${fut ? "future state" : "current state"}</div><h3>${UI.esc(p.short)}</h3></div>
        <div class="small"><strong>Starts:</strong> ${UI.esc(p.trigger)}<br><strong>Done:</strong> ${UI.esc(p.outcome)}</div></div>
      ${UI.table([
        { key: "n", label: "#", num: true },
        { key: "role", label: "Who" },
        { key: "name", label: "Do" },
        { key: "system", label: "In" },
        { key: "sla", label: fut ? "Start" : "Typical wait", fmt: (v, r) => UI.esc(fut ? v : cap(fmtWait(r.s.waitHrs, true))) },
      ], m.procSteps)}
      <div class="sop-qrc-grid">
        <div><h4>Check before you move on</h4><ul>${q.ctrls.map((c) => `<li>Step ${c.n}: ${UI.esc(c.text)}</li>`).join("")}</ul></div>
        <div><h4>Escalate</h4><ul>${q.esc.map((e) => `<li>${UI.esc(e.when)}: <strong>${UI.esc(e.owner)}</strong>, ${UI.esc(e.within.toLowerCase())}</li>`).join("")}</ul></div>
        <div><h4>PHI: never</h4><ul>${q.never.map((x) => `<li>${UI.esc(x)}</li>`).join("")}</ul></div>
        <div><h4>We measure</h4><ul>${q.measure.map((k) => `<li>${UI.esc(k.name)}: target ${UI.esc(k.target)}</li>`).join("")}</ul></div>
      </div>
      <p class="xs muted">Owner: ${UI.esc(m.owner)} · Full procedure: ${UI.esc(m.meta.id)} · Version ${UI.esc(m.meta.version)}</p>
    </div>`;
  }

  // ---------- training & competency check ----------
  function trainingHtml(m) {
    const answered = Object.keys(st.answers).length;
    const right = m.quiz.filter((q, i) => st.answers[i] === q.answer).length;
    return `<div class="stack" style="gap:16px">
      <div class="panel">
        <div class="panel-head"><div><h3>Training plan</h3><p class="panel-sub">${m.ver === "future" ? "Rollout training for the redesigned process, sized by role" : "New-hire training on the process as it runs today"}</p></div>
          ${UI.pill("accent", UI.fmt.num(m.trainHrs) + " training hrs total")}</div>
        ${UI.table([
          { key: "audience", label: "Audience" },
          { key: "people", label: "People", num: true },
          { key: "format", label: "Format" },
          { key: "mins", label: "Duration", num: true, fmt: (v) => UI.esc(v >= 60 ? trimNum(v / 60, 1) + " hrs" : v + " min") },
          { key: "timing", label: "When" },
          { key: "owner", label: "Owner" },
        ], m.training)}
        ${m.ver === "future" && m.paybackDays != null ? `<div class="callout good"><div><strong>${UI.fmt.num(m.trainHrs)} hours of training against ${UI.fmt.num(m.saved)} labor hours a month freed.</strong> Even if only half the savings show up while adoption ramps, the training time is recovered in about ${UI.fmt.dec(Math.max(0.1, m.paybackDays), 1)} working days after go-live. Adoption tracking starts the same week.</div></div>` : ""}
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Competency check</h3><p class="panel-sub">Five questions built from the procedure steps. Pass mark: 4 of 5.</p></div>
          <div class="row">${answered ? UI.pill(right >= 4 ? "good" : "warning", right + " of " + m.quiz.length + " correct") : ""}<button type="button" class="btn sm" data-act="reveal" aria-pressed="${st.reveal}">${st.reveal ? "Hide answers" : "Reveal answers"}</button><button type="button" class="btn ghost sm" data-act="quiz-reset"${answered ? "" : " disabled"}>Clear</button></div></div>
        <div class="sop-quiz">${m.quiz.map((q, i) => {
          const chosen = st.answers[i];
          const show = st.reveal || chosen != null;
          return `<div class="sop-q" role="group" aria-labelledby="sop-q-${i}">
            <div class="sop-q-text" id="sop-q-${i}">${i + 1}. ${UI.esc(q.q)}</div>
            <div class="sop-opts">${q.options.map((o, j) => {
              const cls = show && j === q.answer ? " is-right" : chosen === j && j !== q.answer ? " is-wrong" : "";
              return `<button type="button" class="sop-opt${cls}" data-act="answer" data-q="${i}" data-o="${j}" aria-pressed="${chosen === j}"><span class="sop-letter">${"ABCD"[j]}</span><span>${UI.esc(o)}</span></button>`;
            }).join("")}</div>
            ${show ? `<div class="sop-why">${chosen != null ? (chosen === q.answer ? UI.pill("good", "Correct") : UI.pill("critical", "Not quite")) + " " : ""}${UI.esc(q.why)}</div>` : ""}
          </div>`;
        }).join("")}</div>
        <div class="presenter-note">The check comes from the real steps, so a supervisor can see who is ready before go-live. I would pair it with the adoption tracker to watch usage and error rates in week one, and rerun it after any SOP revision.</div>
      </div>
    </div>`;
  }

  // ---------- actions ----------
  function onAction(act, el, e) {
    if (!model) return;
    if (act === "copy-sop") UI.copy(sopMarkdown(model), "SOP copied as Markdown");
    else if (act === "copy-qrc") UI.copy(qrcMarkdown(model), "Quick-reference card copied");
    else if (act === "copy-quiz") UI.copy(quizMarkdown(model), "Competency check copied, answer key at the end");
    else if (act === "open-map") { if (e) e.preventDefault(); OPS.navigate("workflow", { process: st.pid, view: st.ver }); }
    else if (act === "answer") { st.answers[+el.dataset.q] = +el.dataset.o; renderBody(); }
    else if (act === "reveal") { st.reveal = !st.reveal; renderBody(); }
    else if (act === "quiz-reset") { st.answers = {}; st.reveal = false; renderBody(); }
    else if (act === "ai") runAi();
    else if (act === "ai-copy") { const out = els.ai.querySelector("#sop-ai-out"); if (out) UI.copy(out.textContent, "Rewrite copied"); }
    else if (act === "ai-close") { runToken++; els.ai.innerHTML = ""; }
  }

  async function runAi() {
    const token = ++runToken;
    const md = redact(sopMarkdown(model));
    els.ai.innerHTML = `<div class="panel">
      <div class="panel-head"><div><h3>Claude rewrite (draft)</h3><p class="panel-sub">Sends the SOP text only, with no member data, to Claude in this viewer. Review before you use it.</p></div>
        <div class="row"><button type="button" class="btn sm" data-act="ai-copy" disabled>${UI.icon("copy")}<span>Copy rewrite</span></button><button type="button" class="btn ghost sm" data-act="ai-close">Close</button></div></div>
      <div id="sop-ai-msg" class="small muted">Writing…</div>
      <pre class="code wrap sop-ai-out" id="sop-ai-out" aria-live="polite"></pre>
    </div>`;
    const out = els.ai.querySelector("#sop-ai-out");
    const msg = els.ai.querySelector("#sop-ai-msg");
    const copyBtn = els.ai.querySelector("[data-act='ai-copy']");
    const prompt = "You are an operations writer at a healthcare services company. Rewrite the standard operating procedure below so it is tighter and easier to follow on the floor: short sentences, active voice, one action per numbered step. Keep every step, role, system, SLA, control point, escalation, and PHI rule. Do not invent facts, names, or numbers. Keep the Markdown headings and tables. Return only the revised SOP in Markdown.\n\n---\n" + md;
    try {
      const res = await OPS.ai.ask(prompt, { onText: (u) => { if (token === runToken && out && u && typeof u.text === "string") out.textContent = u.text; } });
      if (token !== runToken || !out.isConnected) return;
      if (res && typeof res.text === "string" && res.text) out.textContent = res.text;
      msg.textContent = "Draft ready. Compare it with the generated SOP before replacing anything.";
      copyBtn.disabled = !out.textContent;
    } catch (err) {
      if (token !== runToken || !msg.isConnected) return;
      msg.innerHTML = `<div class="callout warning"><div>${UI.esc(OPS.ai.message ? OPS.ai.message(err) : "Claude could not answer this time.")} The generated SOP above is unchanged.</div></div>`;
      out.textContent = "";
    }
  }

  OPS.register({
    id: "sop",
    title: "SOP & Training Builder",
    stage: "adopt",
    order: 10,
    icon: "book",
    summary: "Turn a redesigned process into the documents teams need on day one: an SOP with controls and PHI rules, what changes for each role, a quick-reference card, and a training plan with a competency check.",
    jd: [
      "Lightweight documentation, operating procedures, and training",
      "Helping teams adopt AI-enabled solutions",
      "Own initiatives through implementation and adoption",
    ],
    render,
    destroy() { runToken++; },
  });
})();
