/* Throughline — AI Automation Lab (#ailab).
 *
 * Working prototype of OPP-02: outreach call notes -> structured disposition + next actions.
 * Pipeline: trigger -> PHI minimization -> LLM extraction -> validation rules -> confidence routing
 * -> write-back -> audit. The "model" here is a deterministic, rule-based simulation that behaves
 * like a decent extractor (right most of the time, with realistic misses). Live Claude is optional
 * and only ever receives the redacted note.
 *
 * The engine is exposed as OPS.ailab { redact, simulate, validate, route, actionsFor } so other
 * pages can reuse it.
 */
(function () {
  "use strict";
  const OPS = window.OPS;
  const UI = window.UI;
  if (!OPS || !UI) return;

  // ======================================================================================
  // Taxonomy (the label guide QA uses; the JSON schema enums come from here)
  // ======================================================================================
  const INTENTS = ["schedule", "confirm", "reschedule", "callback", "decline", "opt-out", "data-correction", "clinical-concern"];
  const BARRIERS = ["language", "transportation", "caregiver-needed", "schedule-conflict", "cost-concern", "accessibility", "technology", "trust", "food-insecurity", "housing"];
  const REASONS = ["clinical-urgent", "complaint", "roster-update", "sdoh-referral"];
  const REASON_RANK = { "clinical-urgent": 4, complaint: 3, "roster-update": 2, "sdoh-referral": 1 };
  const SDOH_BARRIERS = ["food-insecurity", "housing", "transportation"];
  const BARRIER_SYNONYMS = {
    hearing: "accessibility", "hard-of-hearing": "accessibility", deaf: "accessibility", vision: "accessibility", mobility: "accessibility", disability: "accessibility",
    interpreter: "language", spanish: "language", "language-barrier": "language",
    transport: "transportation", ride: "transportation", "no-ride": "transportation",
    food: "food-insecurity", "food-insecure": "food-insecurity", hunger: "food-insecurity",
    cost: "cost-concern", affordability: "cost-concern", financial: "cost-concern",
    caregiver: "caregiver-needed", "caregiver-involvement": "caregiver-needed", poa: "caregiver-needed",
    "work-schedule": "schedule-conflict", availability: "schedule-conflict", scheduling: "schedule-conflict",
    "digital-access": "technology", internet: "technology", "no-smartphone": "technology",
    "scam-concern": "trust", mistrust: "trust", "fraud-concern": "trust",
    homeless: "housing", "housing-instability": "housing",
  };
  const DISPO_CODE = {
    schedule: "SCHED_BOOKED", confirm: "APPT_CONFIRMED", reschedule: "APPT_CHANGED", callback: "CALLBACK_REQ",
    decline: "DECLINED", "opt-out": "DNC_REQUEST", "data-correction": "ROSTER_EXCEPTION", "clinical-concern": "CLINICAL_ESC",
  };
  const INTENT_SUMMARY = {
    schedule: "Visit booked", confirm: "Existing visit confirmed", reschedule: "Visit changed or needs a new time",
    callback: "Follow-up call needed before an outcome", decline: "Member declined the visit", "opt-out": "Member asked not to be contacted",
    "data-correction": "Roster information is wrong", "clinical-concern": "Member reported symptoms during the call",
  };
  const PROMPT_VERSION = "disposition-v1.3";
  const MODEL_ID = "claude-opus-5-5";

  // ======================================================================================
  // 1. PHI minimization
  // ======================================================================================
  const ID_TYPES = [
    { key: "name", label: "Names", token: "NAME" },
    { key: "dob", label: "Dates of birth", token: "DOB" },
    { key: "memberId", label: "Member IDs", token: "MEMBER_ID" },
    { key: "phone", label: "Phone numbers", token: "PHONE" },
    { key: "address", label: "Street addresses", token: "ADDRESS" },
  ];
  const RE_MEMBER_ID = /\b[A-Z]{2}\d{8}\b/g;
  const RE_PHONE = /(?:\(\d{3}\)[ ]?|\b\d{3}[-. ])\d{3}[-. ]\d{4}\b/g;
  const RE_DOB = /\b(?:DOB|D\.O\.B\.?|date of birth|born)[:#]?[ \t]*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/gi;
  const RE_FULL_DATE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;
  const RE_ADDRESS = /\b\d{1,5}[ \t]+(?:[A-Z][a-z]+[ \t]+){1,3}(?:St|Street|Ln|Lane|Ave|Avenue|Rd|Road|Dr|Drive|Blvd|Ct|Court|Way|Pl|Place|Pkwy|Cir|Ter|Trl)\b\.?(?:[ \t]+(?:Apt|Unit|#)[ \t]*\w+)?(?:,?[ \t]+[A-Z][a-z]+(?:[ \t][A-Z][a-z]+)?,?[ \t]+[A-Z]{2}\b)?(?:[ \t]+\d{5})?/g;
  const RE_NAME_CUE = /\b(?:mbr|member|patient|pt|daughter|son|wife|husband|spouse|caregiver|mother|father|granddaughter|grandson|niece|nephew|sister|brother|poa|spoke with|speaking with|talked to|dr|mr|mrs|ms)\.?[ \t]+/gi;
  const RE_NAME_AT = /^([A-Z][a-z'’-]+(?:[ \t]+[A-Z][a-z'’-]+){0,2})/;
  const NAME_STOP = new Set(("Mon Tue Wed Thu Fri Sat Sun Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July " +
    "August September October November December In The Services Spanish English Plan Medicare Medicaid Called Confirmed Scheduled Asked Said Says Answered " +
    "Is Has Was Wants Needs Prefers Lives Works Advised Apologized Booked Moved Switched").split(" "));
  // residual scan: identifier patterns, plus a cue word still followed by a capitalized name (case-sensitive)
  const RE_RESIDUAL = /\b[A-Z]{2}\d{8}\b|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b|\(\d{3}\)\s?\d{3}-\d{4}|\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b(?:[Mm]br|MBR|[Mm]ember|MEMBER|[Dd]aughter|[Ss]on)\.?[ \t]+(?!Services\b)[A-Z][a-z]{2,}/g;

  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function redact(text) {
    text = String(text || "");
    const spans = [];
    const add = (start, end, type, person) => { if (end > start) spans.push({ start, end, type, person }); };
    let m;
    RE_MEMBER_ID.lastIndex = 0; while ((m = RE_MEMBER_ID.exec(text))) add(m.index, m.index + m[0].length, "memberId");
    RE_PHONE.lastIndex = 0; while ((m = RE_PHONE.exec(text))) add(m.index, m.index + m[0].length, "phone");
    RE_DOB.lastIndex = 0; while ((m = RE_DOB.exec(text))) { const s = m.index + m[0].length - m[1].length; add(s, s + m[1].length, "dob"); }
    RE_FULL_DATE.lastIndex = 0; while ((m = RE_FULL_DATE.exec(text))) add(m.index, m.index + m[0].length, "dob");
    RE_ADDRESS.lastIndex = 0; while ((m = RE_ADDRESS.exec(text))) add(m.index, m.index + m[0].replace(/[\s.,]+$/, "").length, "address");

    // names: capitalized tokens right after a cue word, then every later bare mention of those tokens
    const persons = [];
    const tokenToPerson = {};
    RE_NAME_CUE.lastIndex = 0;
    while ((m = RE_NAME_CUE.exec(text))) {
      const at = m.index + m[0].length;
      const nm = RE_NAME_AT.exec(text.slice(at));
      if (!nm) continue;
      const words = nm[1].split(/[ \t]+/);
      const keep = [];
      for (const w of words) { if (NAME_STOP.has(w)) break; keep.push(w); }
      if (!keep.length) continue;
      const name = keep.join(" ");
      const end = at + text.slice(at).indexOf(keep[keep.length - 1]) + keep[keep.length - 1].length;
      let pid = keep.map((w) => tokenToPerson[w]).find((x) => x != null);
      if (pid == null) { pid = persons.length; persons.push(name); }
      keep.forEach((w) => { tokenToPerson[w] = pid; });
      add(at, end, "name", pid);
    }
    Object.keys(tokenToPerson).forEach((tok) => {
      if (tok.length < 3) return;
      const re = new RegExp("\\b" + reEsc(tok) + "\\b", "g");
      let mm;
      while ((mm = re.exec(text))) add(mm.index, mm.index + tok.length, "name", tokenToPerson[tok]);
    });

    // resolve overlaps: earliest first, longer wins at the same start
    spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const kept = [];
    let lastEnd = -1;
    spans.forEach((s) => { if (s.start >= lastEnd) { kept.push(s); lastEnd = s.end; } });

    // number people by first appearance
    const order = {};
    let n = 0;
    kept.forEach((s) => { if (s.type === "name" && order[s.person] == null) order[s.person] = ++n; });

    const counts = { name: 0, dob: 0, memberId: 0, phone: 0, address: 0 };
    let out = "", origHtml = "", redHtml = "", pos = 0;
    kept.forEach((s) => {
      const tdef = ID_TYPES.find((t) => t.key === s.type);
      const token = "[" + tdef.token + (s.type === "name" ? "_" + order[s.person] : "") + "]";
      s.token = token;
      s.orig = text.slice(s.start, s.end);
      counts[s.type]++;
      const seg = text.slice(pos, s.start);
      out += seg + token;
      origHtml += UI.esc(seg) + `<mark class="al-hit al-k-${s.type}" title="${UI.esc(tdef.label.replace(/s$/, ""))}">${UI.esc(s.orig)}</mark>`;
      redHtml += UI.esc(seg) + `<mark class="al-ph al-k-${s.type}">${UI.esc(token)}</mark>`;
      pos = s.end;
    });
    out += text.slice(pos);
    origHtml += UI.esc(text.slice(pos));
    redHtml += UI.esc(text.slice(pos));
    const residual = (out.match(RE_RESIDUAL) || []).length;
    return { text: out, spans: kept, counts, total: kept.length, residual, origHtml, redHtml, people: n };
  }

  /** escape a redacted string and style its placeholders */
  function phHtml(s) {
    return UI.esc(s).replace(/\[(NAME_\d+|DOB|MEMBER_ID|PHONE|ADDRESS)\]/g, (all, tok) => {
      const type = tok.startsWith("NAME") ? "name" : tok === "DOB" ? "dob" : tok === "MEMBER_ID" ? "memberId" : tok === "PHONE" ? "phone" : "address";
      return `<mark class="al-ph al-k-${type}">${all}</mark>`;
    });
  }

  // ======================================================================================
  // 2. Simulated extractor (stands in for the LLM; deterministic keyword weighting)
  // ======================================================================================
  // Cue weights are tuned to behave like a decent model with realistic blind spots: it anchors on the
  // call type, has a narrow clinical vocabulary ("chest pain" yes, "chest tightness" no), drops barriers
  // that were resolved on the call, and over-reads "can't afford".
  const INTENT_CUES = [
    ["clinical-concern", /chest pain|can'?t breathe|cannot breathe|suicid|overdose|stroke|fainted|passed out|severe bleeding/, 3.2],
    ["data-correction", /passed away|deceased|\bdied\b/, 3],
    ["data-correction", /moved to (?!in-home|telehealth|virtual|an? |the |next |\d)[a-z]+|relocated|new address|outside (of )?(our )?service area/, 2.6],
    ["data-correction", /roster|wrong number/, 1],
    ["opt-out", /do[- ]not[- ]call|\bdnc\b|off the list|take (me|him|her|them) off|stop calling/, 3],
    ["decline", /declin|does not want|doesn'?t want|not interested|refused/, 2.6],
    ["callback", /call(ed)?[ -]?back/, 2.2],
    ["callback", /will call|call (him|her|them) again/, 0.6],
    ["reschedule", /reschedul|switched (him|her|them|mbr|member)? ?to|moved (him|her|them|it|the visit)? ?to (an? )?(in-home|telehealth|virtual)|\bmove (his|her|their|the) (\S+ )?(visit|appointment)|changed (the )?(visit|appointment)/, 2.4],
    ["reschedule", /can'?t do the .{0,24}slot/, 1.4],
    ["reschedule", /evening or weekend|needs? (an )?(evening|weekend)/, 1.0],
    ["reschedule", /\binstead\b/, 0.4],
    ["confirm", /\bconfirm(ed|ing)?\b/, 2.4],
    ["schedule", /\bscheduled\b|\bbooked\b|\bbook (a|the|her|him)\b/, 2.2],
    ["schedule", /wants to schedule|\bagreed\b/, 0.8],
  ];
  const MODEL_BARRIERS = [
    ["language", /spanish|interpreter|limited english|translator|vietnamese|mandarin|cantonese|creole|russian|korean|arabic/],
    ["transportation", /no ride|no transportation|\btransportation\b|no car\b|can'?t drive|doesn'?t drive|no way to get/],
    ["caregiver-needed", /daughter|\bson\b|caregiver|\bpoa\b|power of attorney|guardian|dementia|alzheimer/],
    ["schedule-conflict", /works (days|nights|during)|work schedule|can'?t do the .{0,24}slot|evening or weekend|needs? (an )?(evening|weekend)|only available/],
    ["accessibility", /hard of hearing|\bdeaf\b|\bblind\b|low vision|wheelchair|walker|\btty\b/],
    ["technology", /no smartphone|no internet|no computer|no wi-?fi|no video|doesn'?t have (a )?(smartphone|computer|internet)|can'?t (use|do) video/],
    ["trust", /scam|fraud|\bverify\b|suspicious|legit/],
    ["food-insecurity", /groceries|skipping meals|food (bank|resources|insecurity|stamps)|\bhungry\b|no food/],
    ["housing", /evict|homeless|shelter|housing/],
  ];
  const RE_COST = /can'?t afford|\bcost\b|copay|co-pay|out of pocket|\bbill\b/;
  const RE_COST_RESOLVED = /\$0|no cost|no charge|\bfree\b/;
  const RE_MODEL_SDOH = /lives alone|no ride|no transportation|housing|evict|homeless|utilit|shut ?off|isolat/;
  const RE_MODEL_CLINICAL = /chest pain|can'?t breathe|cannot breathe|suicid|overdose|stroke|fainted|passed out|severe bleeding/;
  const RE_MODEL_COMPLAINT = /upset|angry|irate|report (us|you)|complain|grievance|supervisor/;
  const RE_MODEL_SDOH_REF = /\bsdoh\b|\b211\b|referral|food resources/;
  const RE_CALLBACK = /call(ed)?[ -]?back|will call|call (him|her|them) again/;
  const RE_HEDGE = /\bif possible\b|\bmaybe\b|\bmight\b|\bnot sure\b|\bthought\b|\bpending\b|\bunclear\b|\?/g;

  function sentenceAround(src, idx, len) {
    let a = src.lastIndexOf(". ", idx);
    a = a < 0 ? 0 : a + 2;
    let b = src.indexOf(". ", idx + len);
    b = b < 0 ? src.length : b + 1;
    let s = src.slice(a, b).trim();
    if (s.length > 90) {
      let from = Math.max(0, idx - a - 30);
      if (from > 0) { const sp = s.indexOf(" ", from); from = sp < 0 ? from : sp + 1; }
      let to = Math.min(s.length, from + 84);
      if (to < s.length) { const sp = s.lastIndexOf(" ", to); if (sp > from) to = sp; }
      s = (from > 0 ? "…" : "") + s.slice(from, to).trim() + (to < s.length ? "…" : "");
    }
    return s;
  }

  function simulate(redText) {
    const src = String(redText || "");
    const t = src.toLowerCase();
    const scores = {};
    INTENTS.forEach((i) => (scores[i] = 0));
    const evidence = [];
    INTENT_CUES.forEach(([intent, re, w]) => {
      const m = re.exec(t);
      if (m) { scores[intent] += w; if (w >= 1) evidence.push({ intent, w, q: sentenceAround(src, m.index, m[0].length) }); }
    });
    const ranked = INTENTS.map((i) => [i, scores[i]]).sort((a, b) => b[1] - a[1]);
    let intent = ranked[0][0];
    const s1 = ranked[0][1], s2 = ranked[1][1];

    const barriers = [];
    MODEL_BARRIERS.forEach(([b, re]) => { if (re.test(t) && !barriers.includes(b)) barriers.push(b); });
    let costConflict = false;
    if (RE_COST.test(t)) {
      if (RE_COST_RESOLVED.test(t)) costConflict = true; // model treats a resolved cost question as "no barrier"
      else barriers.push("cost-concern");
    }
    const sdoh = RE_MODEL_SDOH.test(t);
    const callbackNeeded = RE_CALLBACK.test(t);

    let reason = null;
    if (RE_MODEL_CLINICAL.test(t)) reason = "clinical-urgent";
    else if (RE_MODEL_COMPLAINT.test(t)) reason = "complaint";
    else if (intent === "data-correction" && s1 > 0) reason = "roster-update";
    else if (RE_MODEL_SDOH_REF.test(t)) reason = "sdoh-referral";

    const prefs = [];
    if (/spanish[- ]speaking|someone who speaks spanish/.test(t)) prefs.push("Spanish-speaking agent");
    const pm = /prefers? (mornings?|afternoons?|evenings?|weekends?|text|sms)/.exec(t);
    if (pm) prefs.push(pm[1]);

    // self-reported confidence: margin between the top two intents, minus field and ambiguity penalties
    let conf;
    if (s1 === 0) { intent = "callback"; conf = 0.55; }
    else conf = 1 - 0.45 * Math.exp(-0.9 * (s1 - s2));
    conf -= 0.03 * barriers.length;
    if (sdoh) conf -= 0.04;
    if (reason) conf -= 0.04;
    conf -= 0.05 * Math.min(2, (t.match(RE_HEDGE) || []).length);
    if (costConflict) conf -= 0.1;
    // compound call: an escalation that the intent does not explain (e.g. booked + SDOH referral)
    if ((reason === "sdoh-referral" || reason === "complaint") && intent !== "opt-out") conf -= 0.05;
    if (/worried|anxious|confused/.test(t)) conf -= 0.04;
    if (t.length < 60) conf -= 0.06;
    conf = Math.max(0.5, Math.min(0.98, Math.round(conf * 100) / 100));

    const ev = evidence.sort((a, b) => b.w - a.w).map((e) => e.q).filter((q, i, arr) => arr.indexOf(q) === i).slice(0, 3);
    return {
      intent,
      barriers,
      callback_needed: callbackNeeded,
      callback_preference: callbackNeeded && prefs.length ? prefs.join(", ") : null,
      escalate: !!reason,
      escalation_reason: reason,
      sdoh_flag: sdoh,
      summary: summaryFor(intent, barriers, reason),
      confidence: conf,
      evidence: ev,
    };
  }

  function summaryFor(intent, barriers, reason) {
    return (INTENT_SUMMARY[intent] || "Outcome unclear") + (barriers.length ? "; barriers: " + barriers.join(", ") : "") + (reason ? "; escalate as " + reason : "") + ".";
  }

  // ======================================================================================
  // 3. Validation layer (hard rules beat the model)
  // ======================================================================================
  const RE_RED_FLAG = /chest (pain|tightness|pressure)|short(ness)? of breath|trouble breathing|difficulty breathing|can'?t breathe|cannot breathe|\b911\b|suicid|kill (my|him|her|them)sel(f|ves)|wants? to die|end (my|his|her) life|overdose|stroke|slurred speech|unresponsive|passed out|fainted|severe bleeding/i;
  const RE_ROSTER = /passed away|deceased|\bdied\b|moved (out of state|out of (the )?area|to (?!in-home|telehealth|virtual|an? |the |next |mon|tue|wed|thu|fri|sat|sun|\d)[a-z]+)|new address|outside (of )?(our )?service area|wrong number|no longer lives/i;
  const RE_DNC = /do[- ]not[- ]call|\bdnc\b|take (me|him|her|them) off|off (the|your|our) (call )?list|stop calling|remove (me|him|her|them) from/i;
  const RE_COMPLAINT = /upset|angry|irate|report (us|you|this)|complain|grievance|supervisor|attorney|lawyer|harass/i;

  function normBarrier(b) {
    const k = String(b || "").toLowerCase().trim().replace(/[\s_]+/g, "-");
    if (BARRIERS.includes(k)) return k;
    return BARRIER_SYNONYMS[k] || null;
  }

  function validate(raw, redText) {
    const log = [];
    const src = String(redText || "");
    const o = {
      intent: raw && raw.intent, barriers: [], callback_needed: !!(raw && raw.callback_needed),
      callback_preference: raw && raw.callback_preference ? String(raw.callback_preference) : null,
      escalate: !!(raw && raw.escalate), escalation_reason: raw ? raw.escalation_reason || null : null,
      sdoh_flag: !!(raw && raw.sdoh_flag), summary: String((raw && raw.summary) || ""),
      confidence: Number(raw && raw.confidence), evidence: Array.isArray(raw && raw.evidence) ? raw.evidence.map(String).slice(0, 3) : [],
    };
    let schemaFail = false, coreChanged = false, forced = null;
    const before = { intent: o.intent, reason: o.escalation_reason };

    // schema + enums
    const schemaIssues = [];
    if (!INTENTS.includes(o.intent)) { schemaIssues.push(`intent "${o.intent}" is not an allowed value`); o.intent = "callback"; schemaFail = true; }
    (Array.isArray(raw && raw.barriers) ? raw.barriers : []).forEach((b) => {
      const nb = normBarrier(b);
      if (nb && !o.barriers.includes(nb)) { o.barriers.push(nb); if (nb !== b) schemaIssues.push(`barrier "${b}" mapped to "${nb}"`); }
      else if (!nb) schemaIssues.push(`barrier "${b}" is not in the taxonomy and was dropped`);
    });
    if (o.escalation_reason && !REASONS.includes(o.escalation_reason)) { schemaIssues.push(`escalation_reason "${o.escalation_reason}" is not allowed`); o.escalation_reason = null; schemaFail = true; }
    if (!isFinite(o.confidence)) { o.confidence = 0; schemaIssues.push("confidence missing; treated as 0"); }
    if (o.confidence > 1) o.confidence = o.confidence / 100;
    o.confidence = Math.max(0, Math.min(1, o.confidence));
    log.push(schemaIssues.length ? { rule: "Schema and enums", effect: schemaFail ? "block" : "fix", msg: schemaIssues.join("; ") } : { rule: "Schema and enums", effect: "pass", msg: "All fields present; values in the allowed lists." });

    // hard business rules: compute the required escalation from the note text itself
    let required = null;
    const red = RE_RED_FLAG.exec(src);
    if (red) {
      required = "clinical-urgent";
      forced = "clinical";
      const changed = o.intent !== "clinical-concern" || o.escalation_reason !== "clinical-urgent";
      o.intent = "clinical-concern";
      log.push({ rule: "Clinical red flag", effect: changed ? "override" : "pass", msg: `Note mentions "${red[0]}". Escalate clinical-urgent to the RN line; never auto-post.` + (changed ? ` Model said ${before.intent}${before.reason ? " / " + before.reason : ", no escalation"}.` : "") });
    }
    if (!red && RE_ROSTER.test(src)) {
      required = "roster-update";
      const changed = o.intent !== "data-correction";
      if (changed) o.intent = "data-correction";
      log.push({ rule: "Roster change", effect: changed || o.escalation_reason !== "roster-update" ? "override" : "pass", msg: "Deceased, moved or wrong-number language: data-correction with a roster-update ticket; outreach pauses." });
    }
    const dnc = RE_DNC.test(src);
    if (dnc && !red && o.intent !== "data-correction") {
      const changed = o.intent !== "opt-out";
      o.intent = "opt-out";
      log.push({ rule: "Do-not-contact", effect: changed ? "override" : "pass", msg: "Opt-out language: suppress dialer and SMS within 15 minutes." });
    }
    if (RE_COMPLAINT.test(src) && (!required || REASON_RANK.complaint > REASON_RANK[required])) {
      required = "complaint";
      log.push({ rule: "Complaint", effect: o.escalation_reason === "complaint" ? "pass" : "override", msg: "Complaint language: supervisor review within 1 business day; check plan grievance rules." });
    }
    if (required && (!o.escalation_reason || REASON_RANK[required] > REASON_RANK[o.escalation_reason])) {
      o.escalation_reason = required;
      o.escalate = true;
    }
    if (o.escalation_reason === "complaint") forced = forced || "complaint";
    coreChanged = o.intent !== before.intent || o.escalation_reason !== before.reason;

    // consistency
    const fixes = [];
    if (o.escalation_reason && !o.escalate) { o.escalate = true; fixes.push("escalation_reason set, so escalate = true"); }
    if (o.escalate && !o.escalation_reason) { forced = forced || "inconsistent"; fixes.push("escalate = true with no reason; sent to review"); }
    if (!o.escalate) o.escalation_reason = null;
    if (!o.sdoh_flag && (o.escalation_reason === "sdoh-referral" || o.barriers.some((b) => SDOH_BARRIERS.includes(b)))) { o.sdoh_flag = true; fixes.push("SDOH barrier or referral present, so sdoh_flag = true"); }
    if (o.intent === "callback" && !o.callback_needed) { o.callback_needed = true; fixes.push("intent callback, so callback_needed = true"); }
    log.push(fixes.length ? { rule: "Consistency", effect: "fix", msg: fixes.join("; ") + "." } : { rule: "Consistency", effect: "pass", msg: "Flags agree with each other." });

    // PHI must not appear in what we write back
    const outText = [o.summary, o.callback_preference || ""].concat(o.evidence).join(" ");
    const leaks = outText.match(RE_RESIDUAL) || [];
    if (leaks.length) {
      const scrub = (s) => (s == null ? s : String(s).replace(RE_RESIDUAL, "[REDACTED]"));
      o.summary = scrub(o.summary); o.callback_preference = scrub(o.callback_preference); o.evidence = o.evidence.map(scrub);
      log.push({ rule: "PHI in output", effect: "block", msg: `${leaks.length} identifier-like string(s) removed from the output.` });
    } else log.push({ rule: "PHI in output", effect: "pass", msg: "No identifiers in summary, evidence or preferences." });

    o.summary = summaryFor(o.intent, o.barriers, o.escalation_reason);
    const changedFields = [];
    if (raw) {
      if (raw.intent !== o.intent) changedFields.push("intent");
      if ((raw.escalation_reason || null) !== o.escalation_reason) changedFields.push("escalation");
      if (!!raw.sdoh_flag !== o.sdoh_flag) changedFields.push("sdoh");
      if (!!raw.callback_needed !== o.callback_needed) changedFields.push("callback");
      if (!sameSet(Array.isArray(raw.barriers) ? raw.barriers : [], o.barriers)) changedFields.push("barriers");
    }
    return { out: o, log, forced, schemaFail, coreChanged, changedFields };
  }

  /** route one validated note */
  function route(v, thr) {
    if (v.forced === "clinical") return { auto: false, label: "RN line now", reason: "Clinical red flag" };
    if (v.forced === "complaint") return { auto: false, label: "Supervisor", reason: "Complaint" };
    if (v.schemaFail || v.forced) return { auto: false, label: "Review", reason: "Schema or consistency" };
    if (v.coreChanged) return { auto: false, label: "Review", reason: "Rule override" };
    if (v.out.confidence < thr - 1e-9) return { auto: false, label: "Review", reason: "Below threshold" };
    return { auto: true, label: "Auto-post", reason: "Above threshold" };
  }
  /** what routing would do with the model alone (no rule layer) */
  function routeModelOnly(raw, thr) {
    if (raw.escalation_reason === "clinical-urgent") return { auto: false, label: "RN line now", reason: "Model flagged clinical" };
    if (raw.escalation_reason === "complaint") return { auto: false, label: "Supervisor", reason: "Model flagged complaint" };
    if (raw.confidence < thr - 1e-9) return { auto: false, label: "Review", reason: "Below threshold" };
    return { auto: true, label: "Auto-post", reason: "Above threshold" };
  }

  /** next actions come from rules on validated fields, never from free text */
  function actionsFor(o) {
    const a = [{ sys: "CRM", act: "Disposition " + DISPO_CODE[o.intent] }];
    const lang = o.barriers.includes("language");
    if (o.escalation_reason === "clinical-urgent") a.push({ sys: "RN line", act: "Clinical escalation logged; on-call RN confirms the outcome within 1 hour" });
    if (o.intent === "opt-out") a.push({ sys: "Dialer + SMS", act: "Do-not-contact suppression within 15 minutes" });
    if (o.escalation_reason === "complaint") a.push({ sys: "Supervisor", act: "Complaint review within 1 business day; check plan grievance rules" });
    if (o.escalation_reason === "roster-update") a.push({ sys: "Plan ops", act: "Roster-update ticket to the eligibility queue; pause outreach" });
    if (o.callback_needed) a.push({ sys: "CRM task", act: lang ? "Callback via the bilingual queue, SLA 4 business hours" : "Callback task, SLA 1 business day" + (o.callback_preference ? " (" + o.callback_preference + ")" : "") });
    else if (lang) a.push({ sys: "Scheduling", act: "Language flag on the visit request; match a bilingual clinician" });
    if (o.sdoh_flag) a.push({ sys: "Care mgmt", act: "SDOH referral to plan care management with 211 resources" });
    if (o.barriers.includes("transportation")) a.push({ sys: "Scheduling", act: "Offer in-home or the plan ride benefit" });
    if (o.barriers.includes("technology")) a.push({ sys: "Scheduling", act: "Mark telehealth-ineligible; default to in-home" });
    if (o.barriers.includes("accessibility")) a.push({ sys: "CRM", act: "Preferred channel set to SMS" });
    if (o.barriers.includes("caregiver-needed")) a.push({ sys: "CRM", act: "Add authorized representative to the visit" });
    if (o.barriers.includes("schedule-conflict")) a.push({ sys: "Scheduling", act: "Offer evening and weekend slots first" });
    if (o.barriers.includes("trust")) a.push({ sys: "SMS", act: "Send the plan-verified callback number" });
    return a;
  }

  OPS.ailab = { redact, simulate, validate, route, actionsFor, INTENTS, BARRIERS, REASONS };

  // ======================================================================================
  // Evaluation against reviewer labels
  // ======================================================================================
  function sameSet(a, b) { a = a || []; b = b || []; return a.length === b.length && a.every((x) => b.includes(x)); }
  function truthOut(t) {
    return { intent: t.intent, barriers: t.barriers.slice(), callback_needed: t.callbackNeeded, escalate: t.escalate, escalation_reason: t.escalationReason, sdoh_flag: t.sdoh };
  }
  function compare(p, t) {
    const r = {
      intent: p.intent === t.intent,
      barriers: sameSet(p.barriers, t.barriers),
      callback: !!p.callback_needed === !!t.callback_needed,
      escalation: !!p.escalate === !!t.escalate && (p.escalation_reason || null) === (t.escalation_reason || null),
      sdoh: !!p.sdoh_flag === !!t.sdoh_flag,
    };
    r.miss = Object.keys(r).filter((k) => !r[k]);
    r.all = r.miss.length === 0;
    return r;
  }

  let RUN = null;
  function getRun() {
    if (RUN) return RUN;
    RUN = OPS.data.callNotes.map((n) => {
      const red = redact(n.text);
      const raw = simulate(red.text);
      const val = validate(raw, red.text);
      const truth = truthOut(n.truth);
      return { id: n.id, note: n, red, raw, val, truth, rawCmp: compare(raw, truth), finCmp: compare(val.out, truth) };
    });
    return RUN;
  }

  function metrics(thr) {
    const run = getRun();
    const N = run.length;
    const m = { N, thr };
    const prf = (key) => {
      let tp = 0, fp = 0, fn = 0;
      run.forEach((r) => {
        const p = key === "raw" ? r.raw.barriers : r.val.out.barriers, t = r.truth.barriers;
        p.forEach((b) => (t.includes(b) ? tp++ : fp++));
        t.forEach((b) => { if (!p.includes(b)) fn++; });
      });
      const P = tp + fp ? tp / (tp + fp) : 1, R = tp + fn ? tp / (tp + fn) : 1;
      return { P, R, F1: P + R ? (2 * P * R) / (P + R) : 0, tp, fp, fn };
    };
    m.barrRaw = prf("raw"); m.barrFin = prf("fin");
    const rate = (fn) => run.filter(fn).length / N;
    m.intentRaw = rate((r) => r.rawCmp.intent); m.intentFin = rate((r) => r.finCmp.intent);
    m.allRaw = rate((r) => r.rawCmp.all); m.allFin = rate((r) => r.finCmp.all);
    const field = (k) => ({ raw: rate((r) => r.rawCmp[k]), fin: rate((r) => r.finCmp[k]) });
    m.fields = { intent: field("intent"), barriers: field("barriers"), callback: field("callback"), escalation: field("escalation"), sdoh: field("sdoh"), all: { raw: m.allRaw, fin: m.allFin } };
    const esc = run.filter((r) => r.truth.escalate);
    m.escN = esc.length;
    m.escHitRaw = esc.filter((r) => r.raw.escalate && r.raw.escalation_reason === r.truth.escalation_reason).length;
    m.escHitFin = esc.filter((r) => r.val.out.escalate && r.val.out.escalation_reason === r.truth.escalation_reason).length;
    m.escRaw = m.escN ? m.escHitRaw / m.escN : 1; m.escFin = m.escN ? m.escHitFin / m.escN : 1;
    m.caught = run.filter((r) => r.rawCmp.miss.some((k) => !r.finCmp.miss.includes(k)));
    m.caughtSafety = m.caught.filter((r) => r.val.forced === "clinical" && !r.rawCmp.escalation);
    m.residual = run.reduce((s, r) => s + r.red.residual, 0);
    m.ids = run.reduce((s, r) => s + r.red.total, 0);
    Object.assign(m, routeStats(thr, "fin"));
    m.model = routeStats(thr, "raw");
    m.acw = acwFor(m.autoRate, m.reviewRate);
    return m;
  }

  function routeStats(thr, mode) {
    const run = getRun();
    let auto = 0, autoOk = 0, forced = 0, low = 0;
    run.forEach((r) => {
      const rt = mode === "raw" ? routeModelOnly(r.raw, thr) : route(r.val, thr);
      const ok = mode === "raw" ? r.rawCmp.all : r.finCmp.all;
      if (rt.auto) { auto++; if (ok) autoOk++; }
      else if (rt.reason === "Below threshold") low++;
      else forced++;
    });
    const N = run.length;
    return { auto, autoOk, wrong: auto - autoOk, review: N - auto, forced, low, autoRate: auto / N, reviewRate: (N - auto) / N, autoAcc: auto ? autoOk / auto : null };
  }

  // ---------- ACW impact (example assumptions, labeled on the page) ----------
  const AUTO_CUT = 0.5;    // auto-posted call: no disposition coding or task entry
  const REVIEW_CUT = 0.15; // review call: agent confirms a pre-filled draft
  const COST_PER_NOTE = 0.009; // ~1,000 input + ~250 output tokens at current list price
  function callBase() {
    const w = OPS.data.callCenter.weekly;
    const avg = (rows, k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
    const last4 = w.slice(-4);
    return {
      acwNow: avg(last4, "acwSec"), acwPre: avg(w.slice(0, 13), "acwSec"),
      connectsWk: avg(last4, "connects"), callsMonth: (avg(last4, "connects") * 52) / 12,
    };
  }
  function acwFor(autoRate, reviewRate) {
    const b = callBase();
    const secPerCall = b.acwNow * (AUTO_CUT * autoRate + REVIEW_CUT * reviewRate);
    return {
      base: b, secPerCall, pctCut: secPerCall / b.acwNow,
      minPer1000: (secPerCall * 1000) / 60,
      hrsMonth: (secPerCall * b.callsMonth) / 3600,
      fte: (secPerCall * b.callsMonth) / 3600 / 140,
    };
  }

  // ======================================================================================
  // Build artifacts: prompt, schema, n8n export
  // ======================================================================================
  const SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["intent", "barriers", "callback_needed", "callback_preference", "escalate", "escalation_reason", "sdoh_flag", "summary", "confidence", "evidence"],
    properties: {
      intent: { type: "string", enum: INTENTS, description: "Outcome of the call. One value." },
      barriers: { type: "array", items: { type: "string", enum: BARRIERS }, description: "Every barrier the member raised, even if resolved on the call." },
      callback_needed: { type: "boolean", description: "True only when someone owes the member a call." },
      callback_preference: { anyOf: [{ type: "string" }, { type: "null" }], description: "Time window or agent skill the member asked for, else null." },
      escalate: { type: "boolean" },
      escalation_reason: { anyOf: [{ type: "string", enum: REASONS }, { type: "null" }] },
      sdoh_flag: { type: "boolean", description: "Food, housing, transportation, utilities or isolation need." },
      summary: { type: "string", description: "25 words or fewer, placeholders only." },
      confidence: { type: "number", description: "Probability 0 to 1 that every field is right. Range checked in code." },
      evidence: { type: "array", items: { type: "string" }, description: "Up to 3 short quotes from the note that support intent and escalation." },
    },
  };
  const SCHEMA_TEXT = JSON.stringify(SCHEMA, null, 2);

  const PROMPT_SYSTEM = [
    "You code outreach call notes for a member engagement call center. Agents call health plan members to book in-home and telehealth assessments and care-gap visits.",
    "",
    "The note is de-identified. [NAME_n], [DOB], [MEMBER_ID], [PHONE] and [ADDRESS] are placeholders. Never guess or reconstruct what they replace.",
    "",
    "Return one JSON object that matches the schema. Use only the allowed values.",
    "",
    "Label guide",
    "intent: the outcome of this call, one value.",
    "- schedule: a new visit was booked on this call",
    "- confirm: an existing visit was confirmed",
    "- reschedule: an existing visit was moved or changed (time, modality, location), or the member asked to move it",
    "- callback: someone must call again before there is an outcome",
    "- decline: the member refused the visit",
    "- opt-out: the member asked not to be contacted",
    "- data-correction: the roster is wrong (deceased, moved out of the service area, wrong number)",
    "- clinical-concern: the member described symptoms or a safety risk",
    "barriers: record every barrier the member raised, even when the agent resolved it on the call.",
    "escalate / escalation_reason:",
    "- clinical-urgent: symptoms such as chest pain or tightness, shortness of breath, a 911 instruction, or self-harm language",
    "- complaint: the member is upset about contact, threatens to report, or asks for a supervisor",
    "- roster-update: deceased, moved out of area, wrong number",
    "- sdoh-referral: the agent referred or should refer the member for food, housing, transportation or utilities",
    "If more than one applies, pick the highest in that order.",
    "callback_needed: true only when someone owes the member a call.",
    "confidence: your probability that every field is right. Lower it when the note is ambiguous or two intents fit.",
    "evidence: up to 3 short quotes copied from the note.",
    "Keep summary to 25 words or fewer and use placeholders, never real identifiers.",
  ].join("\n");
  const PROMPT_TEXT = "# Prompt template · " + PROMPT_VERSION + "\n# Model: " + MODEL_ID + " via API under BAA · structured outputs · effort low\n\n[system]\n" + PROMPT_SYSTEM + "\n\n[user]\n<note>\n{{redacted_note}}\n</note>";

  function livePrompt(redText) {
    return PROMPT_SYSTEM + "\n\nJSON schema:\n" + JSON.stringify(SCHEMA) + "\n\nRespond with only the JSON object, no prose and no code fence.\n\n<note>\n" + redText + "\n</note>";
  }

  function n8nExport(thr) {
    const redactJs = [
      "// Minimum necessary: strip identifiers before anything leaves our VPC.",
      "if ($env.AI_DISPOSITION_ENABLED !== 'true') throw new Error('Kill switch is off: agent codes manually');",
      "const out = [];",
      "for (const item of $input.all()) {",
      "  let note = item.json.note_text || '';",
      "  const map = {}; let n = 0;",
      "  const sub = (re, tag) => { note = note.replace(re, (m) => { const k = '[' + tag + ']'; map[k] = (map[k] || []).concat(m); n++; return k; }); };",
      "  sub(/\\b[A-Z]{2}\\d{8}\\b/g, 'MEMBER_ID');",
      "  sub(/(?:\\(\\d{3}\\)\\s?|\\b\\d{3}[-. ])\\d{3}[-. ]\\d{4}\\b/g, 'PHONE');",
      "  sub(/\\b\\d{1,2}\\/\\d{1,2}\\/\\d{4}\\b/g, 'DOB');",
      "  sub(/\\b\\d{1,5}\\s+(?:[A-Z][a-z]+\\s+){1,3}(?:St|Ln|Ave|Rd|Dr|Blvd|Ct|Way)\\b\\.?/g, 'ADDRESS');",
      "  note = redactNames(note, map); // cue words (mbr, member, daughter, Dr.) + later mentions -> [NAME_n]",
      "  const residual = note.match(/\\b[A-Z]{2}\\d{8}\\b|\\b\\d{3}[-. ]\\d{3}[-. ]\\d{4}\\b|\\b\\d{1,2}\\/\\d{1,2}\\/\\d{4}\\b/g);",
      "  if (residual) throw new Error('Residual identifier found; model call blocked');",
      "  await $('Token vault').upsert(item.json.call_id, map); // stays in our database",
      "  out.push({ json: { call_id: item.json.call_id, agent_id: item.json.agent_id, redacted_note: note, ids_removed: n,",
      "    claude_request: { model: '" + MODEL_ID + "', max_tokens: 2048, fallbacks: 'default',",
      "      output_config: { effort: 'low', format: { type: 'json_schema', schema: $vars.DISPOSITION_SCHEMA } },",
      "      system: $vars.DISPOSITION_PROMPT_V1_3,",
      "      messages: [{ role: 'user', content: '<note>\\n' + note + '\\n</note>' }] } } });",
      "}",
      "return out;",
    ].join("\n");
    const validateJs = [
      "// Hard rules beat the model. Clinical safety is a rule, not a threshold.",
      "const RED_FLAG = /chest (pain|tightness|pressure)|short(ness)? of breath|trouble breathing|\\b911\\b|suicid|overdose|stroke|fainted/i;",
      "const ROSTER = /passed away|deceased|\\bdied\\b|moved out of (state|area)|new address|outside (our )?service area|wrong number/i;",
      "const DNC = /do[- ]not[- ]call|take (me|him|her) off|stop calling/i;",
      "const COMPLAINT = /upset|angry|report (us|you)|complain|grievance|supervisor/i;",
      "const INTENTS = " + JSON.stringify(INTENTS) + ";",
      "const RANK = { 'clinical-urgent': 4, complaint: 3, 'roster-update': 2, 'sdoh-referral': 1 };",
      "return $input.all().map((item) => {",
      "  const note = $('Redact PHI').item.json.redacted_note;",
      "  const msg = item.json; const text = (msg.content || []).find((b) => b.type === 'text');",
      "  let o; try { o = JSON.parse(text.text); } catch (e) { return { json: { route: 'review', forced_review: true, rule_hits: ['invalid_json'] } }; }",
      "  const hits = []; let required = null; let forced = false;",
      "  if (!INTENTS.includes(o.intent)) { hits.push('enum_intent'); forced = true; }",
      "  if (RED_FLAG.test(note)) { required = 'clinical-urgent'; o.intent = 'clinical-concern'; forced = true; hits.push('clinical_red_flag'); }",
      "  else if (ROSTER.test(note)) { required = 'roster-update'; o.intent = 'data-correction'; hits.push('roster_change'); }",
      "  if (DNC.test(note) && !required) { o.intent = 'opt-out'; hits.push('do_not_contact'); }",
      "  if (COMPLAINT.test(note) && (!required || RANK.complaint > RANK[required])) { required = 'complaint'; forced = true; hits.push('complaint'); }",
      "  if (required && (!o.escalation_reason || RANK[required] > RANK[o.escalation_reason])) { o.escalation_reason = required; o.escalate = true; }",
      "  if (o.escalation_reason === 'sdoh-referral' || (o.barriers || []).some((b) => ['food-insecurity', 'housing', 'transportation'].includes(b))) o.sdoh_flag = true;",
      "  if (o.intent === 'callback') o.callback_needed = true;",
      "  if (hits.some((h) => h !== 'do_not_contact')) forced = true; // any override goes to a person",
      "  return { json: { ...o, call_id: $('Redact PHI').item.json.call_id, rule_hits: hits, forced_review: forced,",
      "    prompt_version: '" + PROMPT_VERSION + "', model: msg.model, latency_ms: $execution.customData.get('latency_ms') } };",
      "});",
    ].join("\n");

    const wf = {
      name: "Call note -> disposition (" + PROMPT_VERSION + ")",
      nodes: [
        { parameters: { content: "## Call note -> disposition\nSelf-hosted n8n inside the VPC. Execution data is not saved (it would contain PHI). Vendors on this canvas all have a signed BAA. Kill switch: set AI_DISPOSITION_ENABLED=false.", height: 200, width: 360 }, id: "a1f0c7e2-0001-4c1a-9b10-5d2f00000001", name: "Read me", type: "n8n-nodes-base.stickyNote", typeVersion: 1, position: [-40, -260] },
        { parameters: { httpMethod: "POST", path: "call-wrapup", authentication: "headerAuth", responseMode: "onReceived", options: {} }, id: "a1f0c7e2-0002-4c1a-9b10-5d2f00000002", name: "Call wrap-up webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: "c3d1b8a4-7e55-4f0b-8a2a-call-wrapup", credentials: { httpHeaderAuth: { id: "11", name: "Dialer webhook HMAC" } } },
        { parameters: { mode: "runOnceForAllItems", jsCode: redactJs }, id: "a1f0c7e2-0003-4c1a-9b10-5d2f00000003", name: "Redact PHI", type: "n8n-nodes-base.code", typeVersion: 2, position: [240, 0] },
        { parameters: { method: "POST", url: "https://api.anthropic.com/v1/messages", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendHeaders: true, headerParameters: { parameters: [{ name: "anthropic-version", value: "2023-06-01" }, { name: "anthropic-beta", value: "server-side-fallback-2026-07-01" }] }, sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify($json.claude_request) }}", options: { timeout: 8000, response: { response: { neverError: true } } } }, id: "a1f0c7e2-0004-4c1a-9b10-5d2f00000004", name: "Claude extract (BAA)", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [480, 0], retryOnFail: true, maxTries: 2, credentials: { httpHeaderAuth: { id: "12", name: "Anthropic API (BAA, zero retention)" } } },
        { parameters: { mode: "runOnceForAllItems", jsCode: validateJs }, id: "a1f0c7e2-0005-4c1a-9b10-5d2f00000005", name: "Validate rules", type: "n8n-nodes-base.code", typeVersion: 2, position: [720, 0] },
        { parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict" }, conditions: [{ id: "c1", leftValue: "={{ $json.confidence }}", rightValue: "={{ Number($env.AUTO_POST_THRESHOLD || " + thr.toFixed(2) + ") }}", operator: { type: "number", operation: "gte" } }, { id: "c2", leftValue: "={{ $json.forced_review }}", rightValue: false, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} }, id: "a1f0c7e2-0006-4c1a-9b10-5d2f00000006", name: "Confidence >= threshold?", type: "n8n-nodes-base.if", typeVersion: 2, position: [960, 0] },
        { parameters: { method: "PATCH", url: "={{ $env.CRM_BASE_URL }}/api/v2/calls/{{ $json.call_id }}/disposition", authentication: "genericCredentialType", genericAuthType: "oAuth2Api", sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({ disposition: $json.intent, barriers: $json.barriers, callback_needed: $json.callback_needed, callback_preference: $json.callback_preference, escalation_reason: $json.escalation_reason, sdoh_flag: $json.sdoh_flag, summary: $json.summary, source: 'ai_auto_post', prompt_version: $json.prompt_version }) }}", options: { timeout: 5000 } }, id: "a1f0c7e2-0007-4c1a-9b10-5d2f00000007", name: "CRM: post disposition + tasks", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [1200, -100], credentials: { oAuth2Api: { id: "13", name: "CRM service account" } } },
        { parameters: { resource: "message", operation: "post", select: "channel", channelId: { __rl: true, value: "C0REVIEWQ", mode: "id", cachedResultName: "outreach-review-queue" }, text: "={{ ($json.escalation_reason === 'clinical-urgent' ? ':rotating_light: RN review now' : 'Review') + ' | call ' + $json.call_id + ' | ' + $json.intent + ' | conf ' + $json.confidence + ' | rules: ' + ($json.rule_hits || []).join(', ') + ' | open in CRM: ' + $env.CRM_BASE_URL + '/calls/' + $json.call_id }}", otherOptions: {} }, id: "a1f0c7e2-0008-4c1a-9b10-5d2f00000008", name: "Review queue (Slack)", type: "n8n-nodes-base.slack", typeVersion: 2.2, position: [1200, 100], credentials: { slackApi: { id: "14", name: "Slack bot (review channel only)" } } },
        { parameters: { operation: "insert", schema: { __rl: true, value: "ops", mode: "list" }, table: { __rl: true, value: "ai_disposition_audit", mode: "list" }, columns: { mappingMode: "defineBelow", value: { call_id: "={{ $('Validate rules').item.json.call_id }}", prompt_version: "={{ $('Validate rules').item.json.prompt_version }}", model: "={{ $('Validate rules').item.json.model }}", ids_removed: "={{ $('Redact PHI').item.json.ids_removed }}", output_json: "={{ JSON.stringify($('Validate rules').item.json) }}", rule_hits: "={{ $('Validate rules').item.json.rule_hits.join(',') }}", route: "={{ $prevNode.name === 'Review queue (Slack)' ? 'review' : 'auto_post' }}", confidence: "={{ $('Validate rules').item.json.confidence }}", created_at: "={{ $now.toISO() }}" } }, options: {} }, id: "a1f0c7e2-0009-4c1a-9b10-5d2f00000009", name: "Audit log (Postgres)", type: "n8n-nodes-base.postgres", typeVersion: 2.5, position: [1440, 0], credentials: { postgres: { id: "15", name: "Ops audit DB (write-only role)" } } },
      ],
      connections: {
        "Call wrap-up webhook": { main: [[{ node: "Redact PHI", type: "main", index: 0 }]] },
        "Redact PHI": { main: [[{ node: "Claude extract (BAA)", type: "main", index: 0 }]] },
        "Claude extract (BAA)": { main: [[{ node: "Validate rules", type: "main", index: 0 }]] },
        "Validate rules": { main: [[{ node: "Confidence >= threshold?", type: "main", index: 0 }]] },
        "Confidence >= threshold?": { main: [[{ node: "CRM: post disposition + tasks", type: "main", index: 0 }], [{ node: "Review queue (Slack)", type: "main", index: 0 }]] },
        "CRM: post disposition + tasks": { main: [[{ node: "Audit log (Postgres)", type: "main", index: 0 }]] },
        "Review queue (Slack)": { main: [[{ node: "Audit log (Postgres)", type: "main", index: 0 }]] },
      },
      active: false,
      settings: { executionOrder: "v1", saveDataSuccessExecution: "none", saveDataErrorExecution: "none", saveManualExecutions: false, saveExecutionProgress: false, executionTimeout: 30, timezone: "America/New_York" },
      pinData: {},
      meta: { templateCredsSetupCompleted: false },
      tags: [{ name: "call-center" }, { name: "ai" }, { name: "phi-minimized" }],
    };
    return JSON.stringify(wf, null, 2);
  }

  // ======================================================================================
  // Page content
  // ======================================================================================
  const EXAMPLE_NOTE = "Mbr Luis Navarro (DOB 01/22/1958, AX55210987) ph 713-555-0110 asked to move his in-home visit from Thu to next Mon afternoon. Says he gets short of breath walking to the mailbox lately. Daughter Ana will be there, he prefers Spanish.";

  const STEPS = [
    { key: "trigger", title: "Trigger", sub: "Call wrap-up in dialer / CRM", icon: "play" },
    { key: "phi", title: "PHI minimization", sub: "Redact what the model doesn't need", icon: "shield", gate: true },
    { key: "llm", title: "LLM extraction", sub: "Prompt + strict JSON schema", icon: "spark" },
    { key: "validate", title: "Validation", sub: "Schema checks + hard business rules", icon: "check", gate: true },
    { key: "route", title: "Confidence routing", sub: "Auto-post or human review", icon: "route", gate: true },
    { key: "write", title: "Write-back", sub: "Disposition, tasks, referrals, tickets", icon: "arrow" },
    { key: "audit", title: "Audit & monitoring", sub: "Every run logged; drift alerts", icon: "chart" },
  ];

  const GUARDRAILS = [
    { item: "BAA signed with the model vendor; zero data retention; no training on our data", gate: "Before shadow", owner: "Compliance + Legal" },
    { item: "Minimum necessary: redact before the model call; a residual scan blocks the call", gate: "Before shadow", owner: "Ops + Engineering" },
    { item: "No PHI in automation logs: execution data off; audit table keeps placeholders and hashes", gate: "Before shadow", owner: "Engineering" },
    { item: "Audit trail per run: prompt and model version, rule hits, route, reviewer action", gate: "Before shadow", owner: "Ops analytics" },
    { item: "Human in the loop for clinical, complaints and any rule override; never auto-posted", gate: "Before assisted", owner: "Clinical lead + Call center mgr" },
    { item: "Kill switch: one flag returns every call to manual coding on the next call", gate: "Before assisted", owner: "Call center manager" },
    { item: "Weekly QA sample of 50 auto-posted notes; error rate above 3% raises the threshold 5 pts", gate: "Before auto-post", owner: "QA lead" },
    { item: "Drift alerts: auto-post rate ±10 pts, override rate above 15%, intent mix shift", gate: "Before auto-post", owner: "Ops analytics" },
  ];

  const RECIPES = [
    { opp: "OPP-01", title: "Risk-based reminder cadence", trigger: "Nightly, for visits 1–7 days out", steps: ["Score no-show risk: lead time, prior no-show, distance, confirmation", "High risk gets two-way SMS, then a live confirm call", "No reply 24h out: release the slot to the backfill list"], outcome: "Higher show rate in Phoenix and Charlotte; fewer empty clinician slots", tools: ["Twilio", "n8n", "Scheduling API"] },
    { opp: "OPP-04", title: "Roster reconciliation diff", trigger: "Plan eligibility file lands on SFTP", steps: ["Load the plan roster and our member file", "SQL diff: termed, moved, deceased, ID mismatch", "Exceptions to a review queue; clean rows apply automatically"], outcome: "A 3-day monthly Excel job becomes an exceptions review; no outreach to termed members", tools: ["SQL", "Python", "Review queue"] },
    { opp: "OPP-12", title: "Credential expiry alerts", trigger: "Daily check of license and credential dates", steps: ["90/60/30-day alerts to the clinician and manager", "At 14 days, escalate to the credentialing lead", "Block new bookings past the expiry date"], outcome: "No clinician drops off the schedule for a lapsed license", tools: ["Airtable", "Zapier"] },
    { opp: "OPP-08", title: "Chart QA pre-check rules", trigger: "Clinician clicks sign on a visit chart", steps: ["Check required fields for the visit type", "Flag inconsistent codes and missing HEDIS elements", "Return a fix list before the chart leaves the visit"], outcome: "Higher QA first-pass rate; bounced charts stop delaying billing 3–5 days", tools: ["EHR rules", "n8n"] },
    { opp: "OPP-07", title: "Weekly ops report auto-build", trigger: "Monday 6am", steps: ["Refresh the governed funnel dataset", "Compute bottleneck alerts by market and plan", "Publish the dashboard; post the top 5 exceptions to the ops channel"], outcome: "The analyst's Monday is freed; the meeting starts from exceptions", tools: ["SQL", "Power BI"] },
  ];

  // ---------- module state (survives theme re-renders) ----------
  const S = {
    step: "validate", redNote: "CN-1004", view: "fin", filter: "all", thr: 0.85, art: "prompt",
    ownSrc: "example", ownText: EXAMPLE_NOTE, ownResult: null, live: null, liveAvail: false,
  };
  let timers = [];
  let liveCtl = null;
  let liveToken = 0;
  let thrChart = null;

  const pct = (v, d = 0) => UI.fmt.pct(v, d);
  const conf = (v) => Math.round(v * 100) + "%";

  // ======================================================================================
  // CSS
  // ======================================================================================
  const CSS = `
  .al-k-name { --k: var(--series-1); }
  .al-k-dob { --k: var(--series-2); }
  .al-k-memberId { --k: var(--series-7); }
  .al-k-phone { --k: var(--series-3); }
  .al-k-address { --k: var(--series-4); }
  .al-hit { background: color-mix(in srgb, var(--k) 22%, transparent); color: var(--ink); border-bottom: 2px solid var(--k); border-radius: 2px; padding: 0 1px; }
  .al-ph { font-family: var(--font-mono); font-size: 0.86em; background: color-mix(in srgb, var(--k) 16%, transparent); color: var(--ink); border: 1px solid color-mix(in srgb, var(--k) 60%, transparent); border-radius: 3px; padding: 0 3px; white-space: nowrap; }
  .al-sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: var(--k); flex: none; }
  .al-headline { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .al-opp { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: space-between; }
  .al-opp p { min-width: 0; flex: 1 1 320px; }

  /* pipeline */
  .al-pipe { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 14px; list-style: none; margin: 0; padding: 0; }
  .al-pipe li { position: relative; min-width: 0; display: flex; }
  .al-pipe li:not(:last-child)::after { content: ""; position: absolute; top: 50%; right: -13px; width: 12px; border-top: 2px solid var(--line-strong); }
  .al-pipe li:not(:last-child)::before { content: ""; position: absolute; top: calc(50% - 4px); right: -14px; border: 5px solid transparent; border-left: 6px solid var(--line-strong); border-right: 0; }
  .al-step { flex: 1; min-width: 0; text-align: left; font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 10px 10px 9px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; transition: border-color .12s, background .12s; }
  .al-step:hover { border-color: var(--accent-line); }
  .al-step[aria-pressed="true"] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: var(--accent-soft); }
  .al-step-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-family: var(--font-mono); font-size: 0.6875rem; color: var(--ink-3); }
  .al-step-top svg { width: 15px; height: 15px; color: var(--ink-3); }
  .al-step[aria-pressed="true"] .al-step-top svg { color: var(--accent); }
  .al-step-title { font-weight: 600; font-size: var(--fs-sm); line-height: 1.25; }
  .al-step-sub { font-size: var(--fs-xs); color: var(--ink-3); line-height: 1.35; }
  .al-step-metric { margin-top: auto; padding-top: 4px; font-family: var(--font-mono); font-size: 0.6875rem; color: var(--ink-2); line-height: 1.35; }
  .al-gate { font-family: var(--font-mono); font-size: 0.625rem; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); border: 1px solid var(--accent-line); border-radius: 3px; padding: 0 4px; }
  .al-detail { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 16px; }
  .al-kv { display: grid; grid-template-columns: minmax(0, 150px) minmax(0, 1fr); gap: 7px 14px; margin: 0; font-size: var(--fs-sm); }
  .al-kv dt { color: var(--ink-3); }
  .al-kv dd { margin: 0; min-width: 0; }
  @media (max-width: 1100px) {
    .al-pipe { grid-template-columns: minmax(0, 1fr); gap: 12px; }
    .al-pipe li:not(:last-child)::after { top: 100%; right: auto; left: 24px; width: 0; height: 12px; border-top: 0; border-left: 2px solid var(--line-strong); }
    .al-pipe li:not(:last-child)::before { display: none; }
    .al-step { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; }
    .al-step-top { grid-column: 1 / -1; }
    .al-step-metric { grid-column: 2; grid-row: 2 / span 2; align-self: center; text-align: right; margin: 0; padding: 0; }
    .al-headline { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 900px) { .al-detail { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 560px) {
    .al-step { grid-template-columns: minmax(0, 1fr); }
    .al-step-metric { grid-column: 1; grid-row: auto; text-align: left; }
    .al-kv { grid-template-columns: minmax(0, 1fr); gap: 2px; }
    .al-kv dd { margin-bottom: 6px; }
  }

  /* redaction */
  .al-doc { font-size: var(--fs-sm); line-height: 1.75; background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-md); padding: 12px 14px; white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
  .al-chips { display: flex; flex-wrap: wrap; gap: 6px 8px; }
  .al-chip { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--ink-2); background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px 2px 8px; }
  .al-chip b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .al-redrow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
  @media (max-width: 900px) { .al-redrow { grid-template-columns: minmax(0, 1fr); } }

  /* batch table */
  .al-table td { font-size: var(--fs-xs); }
  .al-ex { min-width: 230px; max-width: 360px; color: var(--ink-2); line-height: 1.55; }
  .al-tags { display: flex; flex-wrap: wrap; gap: 4px; min-width: 110px; }
  .al-strike { text-decoration: line-through; color: var(--ink-3); }
  .al-ok { color: var(--good-ink); font-weight: 600; white-space: nowrap; }
  .al-bad { color: var(--critical-ink); font-weight: 600; white-space: nowrap; }
  .al-queued td { color: var(--ink-3); }
  tr.al-caught td:first-child { box-shadow: inset 3px 0 0 var(--critical); }
  .al-intent { white-space: nowrap; font-weight: 600; color: var(--ink); }
  .al-sub { display: block; font-size: 0.6875rem; color: var(--ink-3); font-weight: 400; margin-top: 2px; }

  /* threshold */
  .al-thr { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.3fr); gap: 18px; align-items: start; }
  .al-mini { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .al-mini > div { background: var(--surface-2); border-radius: var(--r-md); padding: 8px 10px; min-width: 0; }
  .al-mini b { display: block; font-family: var(--font-display); font-size: 1.3rem; font-variant-numeric: tabular-nums; line-height: 1.2; }
  .al-mini span { font-size: var(--fs-xs); color: var(--ink-3); }
  @media (max-width: 900px) { .al-thr { grid-template-columns: minmax(0, 1fr); } }

  /* own note */
  .al-own { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .al-own > .panel { padding: 14px; }
  .al-own pre.code { max-height: 300px; font-size: 0.72rem; }
  .al-log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: var(--fs-xs); }
  .al-log li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; align-items: start; }
  .al-actions { margin: 0; padding-left: 18px; font-size: var(--fs-xs); color: var(--ink-2); display: flex; flex-direction: column; gap: 3px; }
  .al-actions b { color: var(--ink); font-weight: 600; }
  @media (max-width: 1100px) { .al-own { grid-template-columns: minmax(0, 1fr); } }

  /* governance */
  .al-guard { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 28px; }
  .al-guard li { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: var(--fs-sm); }
  @media (max-width: 1100px) { .al-guard { grid-template-columns: minmax(0, 1fr); } }
  .al-guard svg { width: 18px; height: 18px; color: var(--accent); margin-top: 1px; }
  .al-guard .al-owner { display: block; font-size: var(--fs-xs); color: var(--ink-3); }
  .al-phases { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; list-style: none; margin: 0; padding: 0; counter-reset: ph; }
  .al-phase { border: 1px solid var(--line); border-radius: var(--r-md); padding: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; background: var(--surface); }
  .al-phase.is-next { border-color: var(--accent); box-shadow: inset 0 3px 0 var(--accent); }
  .al-phase h4 { font-size: var(--fs-md); }
  .al-crit { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: var(--fs-xs); }
  .al-crit li { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
  @media (max-width: 1100px) { .al-phases { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 560px) { .al-phases { grid-template-columns: minmax(0, 1fr); } .al-guard li { grid-template-columns: 20px minmax(0, 1fr); } .al-guard li .pill { grid-column: 2; justify-self: start; } }

  /* recipes */
  .al-recipes { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
  .al-recipe { border: 1px solid var(--line); border-radius: var(--r-md); padding: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; background: var(--surface); }
  .al-recipe ol { margin: 0; padding-left: 18px; font-size: var(--fs-xs); color: var(--ink-2); display: flex; flex-direction: column; gap: 3px; }
  .al-recipe .btn { align-self: flex-start; margin-top: auto; }
  .al-arrow-row { font-size: var(--fs-xs); color: var(--ink-2); }
  .al-arrow-row b { color: var(--ink); font-weight: 600; }
  .al-ic { width: 20px; height: 20px; flex: none; margin-top: 1px; color: var(--ink-2); }
  #al-live-stop[hidden] { display: none; }
  .al-art-head { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  `;

  // ======================================================================================
  // Render helpers
  // ======================================================================================
  const reasonPill = (r) => {
    if (!r) return "";
    const lvl = r === "clinical-urgent" ? "critical" : r === "complaint" ? "serious" : r === "roster-update" ? "warning" : "accent";
    return UI.pill(lvl, r);
  };
  const routePill = (rt) => rt.auto ? UI.pill("good", "Auto-post") : UI.pill(rt.reason === "Clinical red flag" || rt.reason === "Model flagged clinical" ? "critical" : "warning", "Review · " + rt.reason.toLowerCase());
  const effectPill = (e) => e === "override" ? UI.pill("critical", "Override") : e === "fix" ? UI.pill("warning", "Fixed") : e === "block" ? UI.pill("serious", "Blocked") : UI.pill("good", "Pass");
  const FIELD_LABEL = { intent: "intent", barriers: "barriers", callback: "callback", escalation: "escalation", sdoh: "SDOH" };

  function excerpt(s, n) {
    if (s.length <= n) return s;
    let cut = s.lastIndexOf(" ", n);
    if (cut < n * 0.6) cut = n;
    return s.slice(0, cut) + " …";
  }
  function jsonView(o) {
    const keys = ["intent", "barriers", "callback_needed", "callback_preference", "escalate", "escalation_reason", "sdoh_flag", "summary", "confidence", "evidence"];
    const out = {};
    keys.forEach((k) => { if (o && k in o) out[k] = o[k]; });
    return JSON.stringify(out, null, 2);
  }
  function logHtml(log) {
    return `<ul class="al-log">${log.map((l) => `<li>${effectPill(l.effect)}<span><b>${UI.esc(l.rule)}.</b> ${UI.esc(l.msg)}</span></li>`).join("")}</ul>`;
  }
  function actionsHtml(o) {
    return `<ul class="al-actions">${actionsFor(o).map((a) => `<li><b>${UI.esc(a.sys)}:</b> ${UI.esc(a.act)}</li>`).join("")}</ul>`;
  }

  // ---------- pipeline ----------
  function stepMetric(key, m) {
    switch (key) {
      case "trigger": return `${m.N} notes in`;
      case "phi": return `${m.ids} identifiers removed · ${m.residual} residual`;
      case "llm": return `${m.N} JSON outputs`;
      case "validate": return `${m.caught.length} errors caught`;
      case "route": return `${m.auto} auto · ${m.review} review`;
      case "write": return `${getRun().reduce((s, r) => s + actionsFor(r.val.out).length, 0)} actions queued`;
      case "audit": return `${m.N} audit rows`;
      default: return "";
    }
  }
  function pipelineHtml(m) {
    return `<ol class="al-pipe" aria-label="Workflow steps">${STEPS.map((s, i) => `<li><button type="button" class="al-step" data-step="${s.key}" aria-pressed="${S.step === s.key}" aria-controls="al-step-detail">
        <span class="al-step-top"><span>${String(i + 1).padStart(2, "0")}</span>${s.gate ? `<span class="al-gate">Gate</span>` : ""}${UI.icon(s.icon)}</span>
        <span class="al-step-title">${UI.esc(s.title)}</span>
        <span class="al-step-sub">${UI.esc(s.sub)}</span>
        <span class="al-step-metric" data-metric="${s.key}">${UI.esc(stepMetric(s.key, m))}</span>
      </button></li>`).join("")}</ol>`;
  }
  function stepDetailHtml(m) {
    const b = callBase();
    const kv = (rows) => `<dl class="al-kv">${rows.map(([k, v]) => `<dt>${UI.esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
    const s = STEPS.find((x) => x.key === S.step);
    const i = STEPS.indexOf(s);
    let what = "", rows = [], code = "", codeLabel = "";
    const run = getRun();
    if (s.key === "trigger") {
      what = "Fires when the agent opens the wrap-up screen. Agents keep typing notes the way they do today, so there is nothing new to learn on day one.";
      rows = [["Event", "<code>call.wrapup.started</code> webhook from the dialer"], ["Payload", "call ID, agent ID, queue, internal member key, note text, call seconds"], ["Auth", "HMAC-signed header; unsigned calls rejected"], ["Time budget", "8 s end to end; past that the agent codes manually as today"], ["Volume", `≈ ${UI.fmt.num(b.connectsWk)} connected calls a week (last 4 weeks)`]];
      codeLabel = "Example payload (synthetic)";
      code = JSON.stringify({ event: "call.wrapup.started", call_id: "C-882134", agent_id: "AG109", queue: "outreach-en", member_key: "mk_7f3a91", call_seconds: 412, note_text: OPS.data.callNotes[1].text }, null, 2);
    } else if (s.key === "phi") {
      what = "Strips identifiers the model does not need before anything leaves our environment. The token map stays in our database, so write-back re-attaches the right member without the model ever seeing them.";
      rows = [["Removed", "Names, dates of birth, member IDs, phone numbers, street addresses"], ["Kept on purpose", "Appointment dates and times, visit type, state, language preference"], ["Method", "Deterministic patterns plus name cues (mbr, member, daughter, Dr.), then every later mention of those names"], ["Fail-safe", "Residual scan; any identifier left blocks the model call"], ["On this batch", `${m.ids} identifiers removed from ${m.N} notes, ${m.residual} residual`]];
      codeLabel = "Patterns (excerpt)";
      code = ["MEMBER_ID  /\\b[A-Z]{2}\\d{8}\\b/", "PHONE      /\\b\\d{3}[-. ]\\d{3}[-. ]\\d{4}\\b/", "DOB        /(DOB|date of birth)\\s*\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}/i", "ADDRESS    /\\d{1,5} (Name ){1,3}(St|Ln|Ave|Rd|Dr|Blvd|Ct|Way)/", "NAME_n     cue word + Capitalized Name, then later bare mentions", "", "RESIDUAL   any of the above left after redaction -> block call"].join("\n");
    } else if (s.key === "llm") {
      what = "One call per note with a versioned prompt and a strict JSON schema, so the output is always parseable and every value comes from an allowed list.";
      rows = [["Model", "Claude via API under a BAA; zero data retention; no training on inputs"], ["Output", "Structured outputs bound to the schema; effort set low for a short extraction task"], ["Prompt", `${PROMPT_VERSION} with a label guide written with QA`], ["Latency budget", "p95 under 4 s"], ["Unit cost", `≈ ${UI.fmt.money(COST_PER_NOTE * 1000)} per 1,000 notes; ≈ ${UI.fmt.money(COST_PER_NOTE * b.callsMonth)} a month at network volume`]];
      codeLabel = "Request body (abridged)";
      code = JSON.stringify({ model: MODEL_ID, max_tokens: 2048, fallbacks: "default", output_config: { effort: "low", format: { type: "json_schema", schema: "<disposition schema>" } }, system: "<" + PROMPT_VERSION + " label guide>", messages: [{ role: "user", content: "<note>" + excerpt(run[5].red.text, 90) + "</note>" }] }, null, 2);
    } else if (s.key === "validate") {
      what = "Deterministic rules run after the model and win every disagreement. Clinical safety is a rule, never a confidence threshold.";
      rows = [["Schema and enums", "Reject or map off-list values; range-check confidence"], ["Clinical red flags", "Chest pain or tightness, shortness of breath, 911, suicidal language: clinical-urgent to the RN line, never auto-posted"], ["Roster", "Deceased, moved out of area, wrong number: data-correction plus a roster-update ticket"], ["Opt-out and complaints", "Do-not-contact suppression; supervisor review"], ["Consistency", "Escalate matches reason; SDOH barriers set the SDOH flag"], ["On this batch", `${m.caught.length} model errors fixed, ${m.caughtSafety.length} of them safety-critical`]];
      codeLabel = "Rule order";
      code = ["1 schema + enums -> block or map", "2 clinical red flag -> clinical-urgent, RN line", "3 roster change -> data-correction, roster-update", "4 do-not-contact -> opt-out, suppress", "5 complaint language -> complaint, supervisor", "6 consistency -> fix flags", "7 PHI in output -> scrub and log", "", "Priority: clinical-urgent > complaint > roster-update > sdoh-referral", "The red-flag rule ignores negation on purpose: \"denies chest pain\"", "still escalates. A false alarm costs one RN review."].join("\n");
    } else if (s.key === "route") {
      what = "The model's confidence decides only the routine cases. Anything clinical, any complaint and any rule override always goes to a person.";
      rows = [["Threshold", `<b>${conf(S.thr)}</b> (set with the slider below)`], ["Always a person", "Clinical red flag (RN), complaint (supervisor), rule override, schema failure"], ["Review queue", "Pre-filled fields plus evidence quotes; one click to accept; SLA 4 business hours"], ["On this batch", `${m.auto} auto-posted, ${m.forced} policy review, ${m.low} below threshold`]];
      codeLabel = "Routing logic";
      code = ["if clinical_red_flag        -> RN line now", "elif complaint               -> supervisor", "elif rule_override or schema -> review", "elif confidence < " + S.thr.toFixed(2) + "        -> review", "else                         -> auto-post"].join("\n");
    } else if (s.key === "write") {
      const ex = run[1];
      what = "Actions come from rules on validated fields, never from model free text, so every task traces back to a field a reviewer can check.";
      rows = [["CRM disposition", "Mapped code, e.g. CALLBACK_REQ, APPT_CONFIRMED"], ["Callback task", "SLA 1 business day; language barrier goes to the bilingual queue with a 4-hour SLA"], ["SDOH referral", "Plan care management referral with 211 resources"], ["Roster update", "Ticket to the eligibility queue; outreach pauses"], ["Opt-out", "Dialer and SMS suppression within 15 minutes"]];
      codeLabel = `Write-back for ${ex.id}`;
      code = JSON.stringify({ call_id: "C-882134", disposition: DISPO_CODE[ex.val.out.intent], actions: actionsFor(ex.val.out).map((a) => a.sys + ": " + a.act) }, null, 2);
    } else {
      what = "Every run leaves a record a compliance reviewer can read without seeing PHI, and the dashboards show drift before agents feel it.";
      rows = [["Logged per run", "Note hash, prompt and model version, redaction counts, raw and validated output, rule hits, route, reviewer action, latency"], ["Retention", "6 years, access-logged, write-only service role"], ["Weekly QA", "Random 50 auto-posted notes double-reviewed"], ["Drift alerts", "Auto-post rate ±10 pts, override rate above 15%, intent mix shift"], ["Kill switch", "One flag returns all calls to manual coding"]];
      codeLabel = "Audit row (example)";
      const r = run[5];
      code = JSON.stringify({ run_id: "run_01J9W3", call_id: "C-882140", note_sha256: "9f2c4e…b71a", prompt_version: PROMPT_VERSION, model: MODEL_ID, ids_removed: r.red.counts, model_output: { intent: r.raw.intent, escalation_reason: r.raw.escalation_reason, confidence: r.raw.confidence }, rule_hits: r.val.log.filter((l) => l.effect !== "pass").map((l) => l.rule), final: { intent: r.val.out.intent, escalation_reason: r.val.out.escalation_reason }, route: "rn_line", reviewer_action: "accepted", latency_ms: 2140 }, null, 2);
    }
    return `<div class="al-detail">
      <div class="stack">
        <div class="row"><span class="label">Step ${i + 1} of 7</span>${s.gate ? UI.pill("accent", "Safety gate") : ""}</div>
        <h3>${UI.esc(s.title)}</h3>
        <p class="small" style="color:var(--ink-2)">${UI.esc(what)}</p>
        ${kv(rows)}
      </div>
      <div class="stack"><span class="label">${UI.esc(codeLabel)}</span><pre class="code wrap">${UI.esc(code)}</pre></div>
    </div>`;
  }

  // ---------- redaction ----------
  function redactionHtml() {
    const run = getRun();
    const r = run.find((x) => x.id === S.redNote) || run[0];
    const totals = { name: 0, dob: 0, memberId: 0, phone: 0, address: 0 };
    run.forEach((x) => Object.keys(totals).forEach((k) => (totals[k] += x.red.counts[k])));
    const chips = (counts) => `<div class="al-chips">${ID_TYPES.map((t) => `<span class="al-chip al-k-${t.key}"><i class="al-sw"></i>${UI.esc(t.label)} <b>${counts[t.key]}</b></span>`).join("")}</div>`;
    return `
      <div class="al-redrow">
        <div class="stack"><div class="row between"><span class="label">Original note (synthetic PHI)</span><span class="xs muted">${r.red.total} identifiers found</span></div><div class="al-doc">${r.red.origHtml}</div></div>
        <div class="stack"><div class="row between"><span class="label">Redacted · what the model receives</span><span class="xs muted">${r.red.text.length} chars</span></div><div class="al-doc">${r.red.redHtml}</div></div>
      </div>
      <div class="stack" style="gap:8px">
        <span class="label">This note, by identifier type</span>${chips(r.red.counts)}
      </div>
      <div class="row" style="gap:8px 16px">
        ${r.red.residual === 0 ? UI.pill("good", "Residual scan: 0 identifiers left") : UI.pill("critical", `Residual scan: ${r.red.residual} left · call blocked`)}
        <span class="xs muted">All 16 notes: ${ID_TYPES.map((t) => `${totals[t.key]} ${t.label.toLowerCase()}`).join(", ")}. Appointment dates, visit type and state stay in on purpose: the model needs them and they do not identify the member on their own.</span>
      </div>`;
  }

  // ---------- batch table ----------
  function rowView(r) {
    const fin = S.view === "fin";
    const p = fin ? r.val.out : r.raw;
    const cmp = fin ? r.finCmp : r.rawCmp;
    const rt = fin ? route(r.val, S.thr) : routeModelOnly(r.raw, S.thr);
    const caught = fin && r.rawCmp.miss.some((k) => !r.finCmp.miss.includes(k));
    return { p, cmp, rt, caught };
  }
  function tableHtml() {
    const run = getRun();
    const rows = run.filter((r) => {
      const v = rowView(r);
      if (S.filter === "auto") return v.rt.auto;
      if (S.filter === "review") return !v.rt.auto;
      if (S.filter === "attention") return !v.cmp.all || v.caught;
      return true;
    });
    const revealed = S.revealed == null ? run.length : S.revealed;
    if (!rows.length) return `<div class="empty">No notes match this filter at a ${conf(S.thr)} threshold.</div>`;
    const body = rows.map((r) => {
      const idx = run.indexOf(r);
      if (idx >= revealed) {
        return `<tr class="al-queued"><td class="mono">${r.id}</td><td class="al-ex">${phHtml(excerpt(r.red.text, 120))}</td><td colspan="6">${UI.pill("neutral", "Queued")}</td></tr>`;
      }
      const { p, cmp, rt, caught } = rowView(r);
      const intentCell = caught && r.raw.intent !== p.intent
        ? `<span class="al-strike">${UI.esc(r.raw.intent)}</span> → <span class="al-intent">${UI.esc(p.intent)}</span>`
        : `<span class="al-intent">${UI.esc(p.intent)}</span>`;
      const flags = [
        p.callback_needed ? UI.tag("Callback") : "",
        p.escalate ? reasonPill(p.escalation_reason) : "",
        p.sdoh_flag ? UI.tag("SDOH") : "",
      ].filter(Boolean).join("") || `<span class="muted">None</span>`;
      const barr = p.barriers.length ? p.barriers.map((b) => UI.tag(b)).join("") : `<span class="muted">None</span>`;
      const match = cmp.all ? `<span class="al-ok">✓ Match</span>` : `<span class="al-bad">✗ ${cmp.miss.map((k) => FIELD_LABEL[k]).join(", ")}</span>`;
      return `<tr class="${caught ? "al-caught" : ""}">
        <td><button type="button" class="btn sm" data-trace="${r.id}" aria-label="Open trace for ${r.id}">${r.id}</button></td>
        <td class="al-ex">${phHtml(excerpt(r.red.text, 120))}</td>
        <td>${intentCell}</td>
        <td><div class="al-tags">${barr}</div></td>
        <td><div class="al-tags">${flags}</div></td>
        <td class="num">${conf(p.confidence)}</td>
        <td>${routePill(rt)}</td>
        <td>${match}${caught ? `<span class="al-sub">${UI.pill("critical", "Caught by rules")}</span><span class="al-sub">Fixed: ${r.rawCmp.miss.filter((k) => !r.finCmp.miss.includes(k)).map((k) => FIELD_LABEL[k]).join(", ")}</span>` : ""}</td>
      </tr>`;
    }).join("");
    return `<div class="table-wrap"><table class="data al-table"><thead><tr><th>Note</th><th>Redacted excerpt</th><th>Intent</th><th>Barriers</th><th>Flags</th><th class="num">Conf.</th><th>Route</th><th>vs reviewer</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function batchSummaryHtml() {
    const m = metrics(S.thr);
    if (S.view === "fin") {
      return `<div class="callout ${m.caughtSafety.length ? "critical" : "good"}">${UI.icon("shield", "al-ic")}<div><strong>Validation caught ${m.caught.length} model mistakes.</strong> ${m.caught.map((r) => `${r.id}: ${r.rawCmp.miss.filter((k) => !r.finCmp.miss.includes(k)).map((k) => FIELD_LABEL[k]).join(" + ")}`).join("; ")}. ${m.caughtSafety.length ? `${m.caughtSafety[0].id} is the one that matters: the model coded a shortness-of-breath call as a routine <b>${UI.esc(m.caughtSafety[0].raw.intent)}</b> at ${conf(m.caughtSafety[0].raw.confidence)} confidence. Without the rule it would have auto-posted.` : ""}</div></div>`;
    }
    const wrongAuto = getRun().filter((r) => routeModelOnly(r.raw, S.thr).auto && !r.rawCmp.all);
    return `<div class="callout warning">${UI.icon("flag", "al-ic")}<div><strong>Model alone, no rule layer:</strong> ${m.model.auto} notes would auto-post and ${wrongAuto.length} of them are wrong (${wrongAuto.map((r) => r.id).join(", ") || "none"}). Escalation recall drops to ${pct(m.escRaw)}. Switch back to see what the validation layer changes.</div></div>`;
  }

  // ---------- scorecard ----------
  function scoreHtml(m) {
    const a = m.acw;
    return `<div class="grid g-4">
      ${UI.kpi({ label: "Intent accuracy", value: pct(m.intentFin, 1), delta: m.intentFin - m.intentRaw, deltaLabel: UI.fmt.pts(m.intentFin - m.intentRaw) + " from rules", foot: `Model alone ${pct(m.intentRaw, 1)}` })}
      ${UI.kpi({ label: "Barrier F1", value: pct(m.barrFin.F1, 1), foot: `Precision ${pct(m.barrFin.P)} · recall ${pct(m.barrFin.R)}` })}
      ${UI.kpi({ label: "Escalation recall", value: pct(m.escFin), delta: m.escFin - m.escRaw, deltaLabel: UI.fmt.pts(m.escFin - m.escRaw) + " from rules", foot: `${m.escHitFin} of ${m.escN} · model alone ${pct(m.escRaw)}` })}
      ${UI.kpi({ label: "All fields correct", value: pct(m.allFin, 1), foot: `${Math.round(m.allFin * m.N)} of ${m.N} notes · model alone ${pct(m.allRaw, 1)}` })}
      ${UI.kpi({ label: `Auto-post rate at ${conf(S.thr)}`, value: pct(m.autoRate, 1), foot: m.autoAcc == null ? "Nothing auto-posts" : `${m.autoOk} of ${m.auto} fully correct` })}
      ${UI.kpi({ label: "Human review rate", value: pct(m.reviewRate, 1), foot: `${m.forced} by policy · ${m.low} below threshold` })}
      ${UI.kpi({ label: "Errors caught by validation", value: String(m.caught.length), foot: `${m.caughtSafety.length} safety-critical · ${m.caught.map((r) => r.id).join(", ")}` })}
      ${UI.kpi({ label: "ACW saved per 1,000 calls", value: UI.fmt.num(a.minPer1000), unit: "min", foot: `≈ ${UI.fmt.num(a.hrsMonth)} hrs a month at network volume` })}
    </div>`;
  }

  // ---------- threshold ----------
  function thrTextHtml() {
    const m = metrics(S.thr);
    const near = (d) => { const t = Math.round((S.thr + d) * 100) / 100; return t < 0.5 || t > 0.99 ? null : Object.assign({ t }, routeStats(t, "fin"), { acw: null }); };
    const lo = near(-0.05), hi = near(0.05);
    let s = `<p>At <b>${conf(S.thr)}</b>, <b>${m.auto} of ${m.N}</b> notes post on their own (${pct(m.autoRate)})`;
    s += m.auto ? ` and <b>${m.autoOk} of ${m.auto}</b> match the reviewer on every field.` : ".";
    s += ` The other ${m.review} go to a person: ${m.forced} because policy always requires one (clinical, complaint, rule override) and ${m.low} because the model was less sure.</p>`;
    const parts = [];
    const notes = (n) => `${n} ${n === 1 ? "note auto-posts" : "notes auto-post"}`;
    if (lo) parts.push(`Lower it to ${conf(lo.t)} and ${lo.auto === m.auto ? "nothing changes" : notes(lo.auto - m.auto).replace(" ", " more ")}${lo.auto === m.auto ? "" : lo.wrong - m.wrong > 0 ? `, with <b>${lo.wrong - m.wrong} more wrong disposition${lo.wrong - m.wrong === 1 ? "" : "s"}</b> reaching the CRM` : ", with no new errors on this sample"}.`);
    if (hi) parts.push(`Raise it to ${conf(hi.t)} and ${m.auto === hi.auto ? "nothing changes" : notes(m.auto - hi.auto).replace(" ", " fewer ")}${m.auto === hi.auto ? "" : m.wrong - hi.wrong > 0 ? `, removing ${m.wrong - hi.wrong} error${m.wrong - hi.wrong === 1 ? "" : "s"}` : `, with no accuracy gain on this sample`}.`);
    s += `<p>${parts.join(" ")}</p>`;
    s += `<p class="xs muted">At this threshold the workflow saves about <b>${UI.fmt.num(m.acw.minPer1000)} agent minutes per 1,000 calls</b> (${pct(m.acw.pctCut)} of today's ${UI.fmt.mmss(m.acw.base.acwNow)} ACW), or <b>${UI.fmt.num(m.acw.hrsMonth)} hours a month</b> across ≈ ${UI.fmt.compact(m.acw.base.callsMonth)} connected calls (≈ ${UI.fmt.dec(m.acw.fte, 1)} agent FTE). Sixteen notes is a demo sample; the production decision uses 300+ double-labeled notes from shadow mode.</p>`;
    return s;
  }
  function thrMiniHtml() {
    const m = metrics(S.thr);
    return `<div><b>${m.auto}</b><span>auto-posted</span></div><div><b>${m.review}</b><span>to review</span></div><div><b>${m.wrong}</b><span>wrong auto-posts</span></div><div><b>${UI.fmt.num(m.acw.hrsMonth)}</b><span>hrs saved / month</span></div>`;
  }
  function sweep() {
    const out = [];
    for (let t = 50; t <= 99; t++) { const r = routeStats(t / 100, "fin"); out.push({ t, autoRate: r.autoRate, autoAcc: r.autoAcc }); }
    return out;
  }

  // ---------- own note ----------
  function runOwnSim() {
    const red = redact(S.ownText);
    const raw = simulate(red.text);
    const val = validate(raw, red.text);
    const src = OPS.data.callNotes.find((n) => n.id === S.ownSrc);
    const truth = src && src.text === S.ownText ? truthOut(src.truth) : null;
    S.ownResult = { red, raw, val, truth };
  }
  function ownHtml() {
    const r = S.ownResult;
    if (!r) return "";
    const rt = route(r.val, S.thr);
    const cmpLine = (o) => {
      if (!r.truth) return "";
      const c = compare(o, r.truth);
      return c.all ? `<span class="al-ok">✓ Matches reviewer</span>` : `<span class="al-bad">✗ Differs: ${c.miss.map((k) => FIELD_LABEL[k]).join(", ")}</span>`;
    };
    const live = S.live;
    let liveBody;
    if (!S.liveAvail) {
      liveBody = `<p class="xs muted">Live mode runs when this page is opened as a Claude artifact; the simulation is shown here.</p>`;
    } else if (!live) {
      liveBody = `<p class="xs muted">Sends only the redacted note above, the prompt and the schema. The reply goes through the same validation rules before anything is shown.</p>`;
    } else if (live.status === "running") {
      liveBody = `<div class="row">${UI.pill("accent", "Running")}<span class="xs muted">Streaming from Claude</span></div><pre class="code wrap" id="al-live-stream">${UI.esc(live.text || "Thinking…")}</pre>`;
    } else if (live.status === "error") {
      liveBody = `<div class="callout warning">${UI.esc(live.message)}</div>${live.text ? `<pre class="code wrap">${UI.esc(live.text)}</pre>` : ""}`;
    } else {
      const lrt = route(live.val, S.thr);
      liveBody = `<div class="row">${routePill(lrt)}${cmpLine(live.val.out)}</div>
        <span class="label">Claude output after validation</span><pre class="code wrap">${UI.esc(jsonView(live.val.out))}</pre>
        <span class="label">Rules applied to Claude's answer</span>${logHtml(live.val.log.filter((l) => l.effect !== "pass").length ? live.val.log.filter((l) => l.effect !== "pass") : [{ rule: "All rules", effect: "pass", msg: "No overrides needed." }])}`;
    }
    const truthBody = r.truth
      ? `<pre class="code wrap">${UI.esc(JSON.stringify(r.truth, null, 2))}</pre><p class="xs muted">Labeled by a QA reviewer using the same guide as the prompt.</p>`
      : `<p class="xs muted">No reviewer label for a new note. In shadow mode QA labels a random sample like this one, and those labels become the eval set.</p>`;
    return `
      <div class="stack" style="gap:8px">
        <div class="row between"><span class="label">Sent to the model (redacted)</span>${r.red.residual === 0 ? UI.pill("good", `${r.red.total} identifiers removed · 0 residual`) : UI.pill("critical", `${r.red.residual} residual identifiers · live call blocked`)}</div>
        <div class="al-doc">${r.red.redHtml}</div>
      </div>
      <div class="al-own">
        <div class="panel inset stack">
          <div class="row between"><h3>Simulation + validation</h3>${routePill(rt)}</div>
          ${cmpLine(r.val.out)}
          <pre class="code wrap">${UI.esc(jsonView(r.val.out))}</pre>
          <span class="label">Rule log</span>${logHtml(r.val.log)}
          <span class="label">Write-back</span>${actionsHtml(r.val.out)}
        </div>
        <div class="panel inset stack" aria-live="polite">
          <div class="row between"><h3>Live Claude</h3>${S.liveAvail ? UI.pill("good", "Available") : UI.pill("neutral", "Simulation only")}</div>
          ${liveBody}
        </div>
        <div class="panel inset stack">
          <div class="row between"><h3>Reviewer label</h3>${r.truth ? UI.pill("accent", "Ground truth") : UI.pill("neutral", "New note")}</div>
          ${truthBody}
        </div>
      </div>`;
  }

  // ---------- governance ----------
  function governanceHtml(m) {
    const guard = `<ul class="al-guard">${GUARDRAILS.map((g) => `<li>${UI.icon("shield")}<span>${UI.esc(g.item)}<span class="al-owner">Owner: ${UI.esc(g.owner)}</span></span>${UI.pill(g.gate === "Before shadow" ? "accent" : g.gate === "Before assisted" ? "warning" : "serious", g.gate)}</li>`).join("")}</ul>`;
    const met = (ok) => ok == null ? UI.pill("neutral", "Measured in phase") : ok ? UI.pill("good", "Met on sample") : UI.pill("critical", "Not met on sample");
    const thr97 = routeStats(S.thr, "fin");
    const phases = [
      { name: "Shadow mode", dur: "2 weeks", what: "Runs on every wrap-up and writes nothing back. QA double-labels 300 notes and we compare.", exit: [["Intent accuracy ≥ 90%", m.intentFin >= 0.9], ["Escalation recall 100%", m.escFin === 1], ["0 residual identifiers sent", m.residual === 0], ["p95 latency under 4 s", null]] },
      { name: "Assisted", dur: "2–3 weeks", what: "Agents see the pre-filled disposition and confirm or edit it. Nothing posts without a click.", exit: [["Agent adoption ≥ 80% of calls", null], ["Accepted without edits ≥ 70%", null], ["ACW −20% vs baseline", null]] },
      { name: "Partial auto-post", dur: "4 weeks", what: "Notes above the threshold post on their own; the rest stay assisted. Weekly QA sample of 50.", exit: [["Auto-posted accuracy ≥ 97% in QA", thr97.autoAcc == null ? null : thr97.autoAcc >= 0.97], ["Escalation recall stays 100%", m.escFin === 1], ["ACW −30% vs baseline", null], ["Complaint rate flat", null]] },
      { name: "Scale", dur: "Ongoing", what: "All outreach queues, Spanish-language notes and inbound calls. Threshold reviewed monthly.", exit: [["ACW −30% held for 4 weeks", null], ["Schedule conversion not lower", null], ["QA sampling continues", null]] },
    ];
    const phaseHtml = `<ol class="al-phases" aria-label="Rollout phases">${phases.map((p, i) => `<li class="al-phase${i === 0 ? " is-next" : ""}">
        <div class="row between"><span class="label">Phase ${i + 1} · ${UI.esc(p.dur)}</span>${i === 0 ? UI.pill("accent", "Next") : ""}</div>
        <h4>${UI.esc(p.name)}</h4>
        <p class="xs" style="color:var(--ink-2)">${UI.esc(p.what)}</p>
        <span class="label">Exit criteria</span>
        <ul class="al-crit">${p.exit.map(([t, ok]) => `<li><span>${UI.esc(t)}</span>${met(ok)}</li>`).join("")}</ul>
      </li>`).join("")}</ol>`;
    return { guard, phaseHtml };
  }

  function recipesHtml() {
    return `<div class="al-recipes">${RECIPES.map((r) => {
      const o = OPS.opps && OPS.opps.get ? OPS.opps.get(r.opp) : null;
      return `<article class="al-recipe">
        <div class="row between"><h4>${UI.esc(r.title)}</h4><span class="tag">${r.opp}</span></div>
        <div class="al-arrow-row"><b>Trigger:</b> ${UI.esc(r.trigger)}</div>
        <ol>${r.steps.map((s) => `<li>${UI.esc(s)}</li>`).join("")}</ol>
        <div class="al-arrow-row"><b>Outcome:</b> ${UI.esc(r.outcome)}</div>
        <div class="row" style="gap:4px">${r.tools.map((t) => UI.tag(t)).join("")}</div>
        <button type="button" class="btn sm" data-opp="${r.opp}" title="${UI.esc(o ? o.title : r.title)}">Open ${r.opp} in pipeline ${UI.icon("arrow")}</button>
      </article>`;
    }).join("")}</div>`;
  }

  function artifactText() {
    if (S.art === "schema") return SCHEMA_TEXT;
    if (S.art === "n8n") return n8nExport(S.thr);
    return PROMPT_TEXT;
  }
  function artifactMeta() {
    if (S.art === "schema") return `JSON Schema · ${SCHEMA.required.length} required fields · additionalProperties false · enums from the QA label guide`;
    if (S.art === "n8n") { const wf = JSON.parse(n8nExport(S.thr)); return `n8n workflow export · valid JSON · ${wf.nodes.length} nodes · threshold ${S.thr.toFixed(2)} · execution data saving off`; }
    return `${PROMPT_VERSION} · ${PROMPT_SYSTEM.split("\n").length} lines · used verbatim by the live run on this page`;
  }

  // ======================================================================================
  // Render
  // ======================================================================================
  function render(root, ctx) {
    UI.style("ailab", CSS);
    clearTimers();
    S.revealed = null;
    if (!S.ownResult) runOwnSim();
    const m = metrics(S.thr);
    const b = callBase();
    const opp02 = OPS.opps && OPS.opps.get ? OPS.opps.get("OPP-02") : null;

    root.innerHTML = `
      <div class="presenter-note">This is OPP-02 from my pipeline, built end to end. The model is the easy part; what makes it shippable in a HIPAA shop is the controls around it: redaction before the call, rules that override the model, confidence routing, and an eval against reviewer labels.</div>

      <section class="panel" aria-labelledby="al-h-sum">
        <div class="al-opp">
          <p class="small" style="color:var(--ink-2)"><b id="al-h-sum" style="color:var(--ink)">Prototype of ${opp02 ? UI.esc(opp02.id + " · " + opp02.title) : "OPP-02 · AI call-note summarization and disposition coding"}.</b> ACW went from ${UI.fmt.mmss(b.acwPre)} to ${UI.fmt.mmss(b.acwNow)} after the W14 scheduling-system change, and dispositions vary by agent. This workflow codes the note for the agent and routes anything risky to a person.</p>
          <div class="row"><button type="button" class="btn sm" data-nav="pipeline">Open in pipeline ${UI.icon("arrow")}</button><button type="button" class="btn sm" data-nav="roi">Model ROI ${UI.icon("arrow")}</button></div>
        </div>
        <div class="al-headline" id="al-headline">${headlineHtml(m)}</div>
      </section>

      <section class="panel" aria-labelledby="al-h-pipe">
        <div class="panel-head"><div><h2 id="al-h-pipe">1 · The workflow</h2><p class="panel-sub">Seven steps from wrap-up to audit log. Select a step to see how it is configured.</p></div>${UI.pill("accent", "3 safety gates")}</div>
        <div id="al-pipe">${pipelineHtml(m)}</div>
        <div id="al-step-detail" class="panel inset" aria-live="polite">${stepDetailHtml(m)}</div>
      </section>

      <section class="panel" aria-labelledby="al-h-red">
        <div class="panel-head"><div><h2 id="al-h-red">2 · PHI minimization</h2><p class="panel-sub">HIPAA minimum necessary, applied before the model sees anything.</p></div>
          <div style="min-width:200px">${UI.select("al-red-note", OPS.data.callNotes.map((n) => ({ value: n.id, label: n.id + " · " + OPS.q.marketName(n.market) })), S.redNote, "Note")}</div></div>
        <div id="al-red" class="stack">${redactionHtml()}</div>
      </section>

      <section class="panel" aria-labelledby="al-h-batch">
        <div class="panel-head"><div><h2 id="al-h-batch">3 · Batch run: 16 call notes</h2><p class="panel-sub">Simulated extractor, then the validation rules, then routing at the current threshold. Compared field by field with the QA reviewer's label.</p></div>
          <button type="button" class="btn primary sm" id="al-rerun">${UI.icon("play")}Re-run batch</button></div>
        <div class="row between">
          ${UI.seg("al-view", [{ value: "fin", label: "With validation rules" }, { value: "raw", label: "Model alone" }], S.view)}
          ${UI.seg("al-filter", [{ value: "all", label: "All" }, { value: "auto", label: "Auto-post" }, { value: "review", label: "Human review" }, { value: "attention", label: "Needs attention" }], S.filter)}
        </div>
        <div id="al-batch-sum">${batchSummaryHtml()}</div>
        <div id="al-table">${tableHtml()}</div>
        <p class="xs muted">Select a note ID to open its full trace: redacted text, raw model output, every rule decision, the final JSON and the write-back actions.</p>
        <div class="presenter-note">Look at CN-1006: the model coded a shortness-of-breath call as a routine confirmation at high confidence. The rule layer caught it. That is why clinical safety is a rule and not a threshold, and why 100% escalation recall is my launch gate.</div>
      </section>

      <section class="panel" aria-labelledby="al-h-eval">
        <div class="panel-head"><div><h2 id="al-h-eval">4 · Evaluation scorecard</h2><p class="panel-sub">Against reviewer labels for all 16 notes. Model alone vs. model plus validation rules.</p></div></div>
        <div id="al-score">${scoreHtml(m)}</div>
        <div class="grid g-2">
          <div class="stack">
            <span class="label">Field accuracy</span>
            <div class="chart-box"><canvas id="al-field-chart" role="img" aria-label="Field accuracy, model alone versus with validation rules"></canvas></div>
          </div>
          <div class="stack">
            <div class="callout accent">${UI.icon("target", "al-ic")}<div><strong>Launch gate: escalation recall must be 100%.</strong> A missed clinical-urgent or complaint escalation is a member-safety and plan-compliance event, while a wrong barrier tag is a data-quality fix. So recall on escalations is a hard gate, enforced by rules and tested with adversarial notes ("denies chest pain", "my chest feels tight"). Accuracy targets on the other fields can be tuned; this one cannot.</div></div>
            <div class="callout">${UI.icon("book", "al-ic")}<div><strong>What the misses teach.</strong> The remaining errors are barrier tags: the model drops a cost concern the agent resolved on the call, and reads "can't afford groceries" as a cost barrier. Both are prompt fixes (worked examples in the label guide) and both are caught in review or the weekly QA sample before they matter.</div></div>
            <p class="xs muted">ACW assumptions (Example, replace with time-study data from shadow mode): auto-posted calls drop ${pct(AUTO_CUT)} of ACW because disposition coding and task entry disappear; review calls drop ${pct(REVIEW_CUT)} because the agent confirms a pre-filled draft. Baseline is the last 4 weeks: ${UI.fmt.mmss(b.acwNow)} ACW and ≈ ${UI.fmt.num(b.connectsWk)} connected calls a week.</p>
          </div>
        </div>
      </section>

      <section class="panel" aria-labelledby="al-h-thr">
        <div class="panel-head"><div><h2 id="al-h-thr">5 · Where to set the auto-post threshold</h2><p class="panel-sub">Drag the threshold. Routing, the table above, the scorecard and the n8n export all update.</p></div></div>
        <div class="al-thr">
          <div class="stack">
            ${UI.range({ id: "al-thr", label: "Auto-post when confidence is at least", min: 50, max: 99, step: 1, value: Math.round(S.thr * 100), display: conf(S.thr) })}
            <div class="al-mini" id="al-thr-mini">${thrMiniHtml()}</div>
            <div class="stack small" id="al-thr-text" aria-live="polite" style="gap:8px">${thrTextHtml()}</div>
          </div>
          <div class="stack">
            <div class="chart-box lg"><canvas id="al-thr-chart" role="img" aria-label="Auto-post rate and accuracy of auto-posted notes by confidence threshold"></canvas></div>
          </div>
        </div>
        <div class="presenter-note">This slider is the conversation I would have with the call-center manager. At 85% about two thirds of notes post themselves with zero errors on this sample; drop to 80% and the one extra note that auto-posts is a wrong disposition. We start conservative and lower it only when the weekly QA data says we can.</div>
      </section>

      <section class="panel" aria-labelledby="al-h-own">
        <div class="panel-head"><div><h2 id="al-h-own">6 · Try a note</h2><p class="panel-sub">Paste or edit a synthetic note. Redaction, extraction and validation run in the browser.</p></div></div>
        <div class="grid g-3" style="align-items:end">
          <div>${UI.select("al-own-src", [{ value: "example", label: "Example: new note (not in the eval set)" }].concat(OPS.data.callNotes.map((n) => ({ value: n.id, label: n.id + " (has reviewer label)" }))), S.ownSrc, "Start from")}</div>
          <div class="row span-2" style="justify-content:flex-end">
            <button type="button" class="btn primary" id="al-own-run">${UI.icon("play")}Run simulation</button>
            <button type="button" class="btn" id="al-live-run" disabled>${UI.icon("spark")}Run with live Claude</button>
            <button type="button" class="btn ghost" id="al-live-stop" hidden>${UI.icon("x")}Stop</button>
          </div>
        </div>
        <label class="field" for="al-own-text"><span>Call note (synthetic only; never paste real member data)</span><textarea class="textarea" id="al-own-text" rows="4">${UI.esc(S.ownText)}</textarea></label>
        <p class="xs muted" id="al-live-line">${S.liveAvail ? "Live Claude is available. It receives only the redacted note, the prompt and the schema." : "Live mode runs when this page is opened as a Claude artifact; the simulation is shown here."}</p>
        <div id="al-own-out" class="stack">${ownHtml()}</div>
      </section>

      <section class="panel" aria-labelledby="al-h-art">
        <div class="panel-head"><div><h2 id="al-h-art">7 · Build artifacts</h2><p class="panel-sub">What I would hand engineering: the prompt, the schema and an importable n8n workflow.</p></div></div>
        <div class="al-art-head">
          ${UI.seg("al-art", [{ value: "prompt", label: "Prompt template" }, { value: "schema", label: "JSON schema" }, { value: "n8n", label: "n8n workflow" }], S.art)}
          <button type="button" class="btn sm" id="al-copy">${UI.icon("copy")}Copy</button>
        </div>
        <p class="xs muted" id="al-art-meta">${UI.esc(artifactMeta())}</p>
        <pre class="code${S.art === "prompt" ? " wrap" : ""}" id="al-art-code">${UI.esc(artifactText())}</pre>
      </section>

      <section class="panel" aria-labelledby="al-h-gov">
        <div class="panel-head"><div><h2 id="al-h-gov">8 · Governance and rollout</h2><p class="panel-sub">The guardrails and the exit criteria that let each phase start.</p></div></div>
        <div id="al-gov"></div>
        <div class="presenter-note">In week one I would put this in shadow mode on two weeks of real wrap-ups, have QA double-label 300 notes, and bring these exact numbers to the call-center manager before a single disposition is written back.</div>
      </section>

      <section class="panel" aria-labelledby="al-h-more">
        <div class="panel-head"><div><h2 id="al-h-more">9 · More automations I would build</h2><p class="panel-sub">Same pattern: trigger, deterministic steps, a person on the exceptions, a measured outcome.</p></div></div>
        ${recipesHtml()}
      </section>`;

    renderGov(root);
    drawFieldChart(m);
    drawThrChart();
    wire(root, ctx);

    // check live availability once after render (does not call the model)
    OPS.ai.available().then((ok) => {
      S.liveAvail = !!ok;
      const btn = root.querySelector("#al-live-run");
      if (!btn || !document.body.contains(btn)) return;
      btn.disabled = !ok;
      const line = root.querySelector("#al-live-line");
      if (line) line.textContent = ok ? "Live Claude is available. It receives only the redacted note, the prompt and the schema." : "Live mode runs when this page is opened as a Claude artifact; the simulation is shown here.";
      refreshOwn(root);
    }).catch(() => {});
  }

  function headlineHtml(m) {
    return [
      UI.kpi({ label: "Intent accuracy", value: pct(m.intentFin, 1), foot: "16 labeled notes" }),
      UI.kpi({ label: "Escalation recall", value: pct(m.escFin), foot: "Launch gate: 100%" }),
      UI.kpi({ label: `Auto-post at ${conf(S.thr)}`, value: pct(m.autoRate, 1), foot: m.autoAcc == null ? "None auto-posted" : `${pct(m.autoAcc)} fully correct` }),
      UI.kpi({ label: "ACW hours saved / month", value: UI.fmt.num(m.acw.hrsMonth), foot: `${pct(m.acw.pctCut)} of ACW · example assumptions` }),
    ].join("");
  }

  function renderGov(root) {
    const m = metrics(S.thr);
    const g = governanceHtml(m);
    const el = root.querySelector("#al-gov");
    if (!el) return;
    el.innerHTML = `<div class="stack" style="gap:18px">
        <div class="stack"><span class="label">Guardrails checklist</span>${g.guard}</div>
        <div class="stack"><span class="label">Rollout path · each phase starts only when the previous one's exit criteria are met</span>${g.phaseHtml}</div>
      </div>`;
  }

  // ---------- charts ----------
  function drawFieldChart(m) {
    const labels = ["Intent", "Barriers (exact)", "Callback needed", "Escalation + reason", "SDOH flag", "All fields"];
    const keys = ["intent", "barriers", "callback", "escalation", "sdoh", "all"];
    UI.chart("al-field-chart", {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Model alone", data: keys.map((k) => m.fields[k].raw), backgroundColor: UI.series(0), borderRadius: 4, maxBarThickness: 14 },
          { label: "With validation rules", data: keys.map((k) => m.fields[k].fin), backgroundColor: UI.series(1), borderRadius: 4, maxBarThickness: 14 },
        ],
      },
      options: {
        indexAxis: "y",
        scales: { x: { min: 0, max: 1, ticks: { callback: UI.pctTick } }, y: { grid: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${pct(c.raw, 1)}` } } },
      },
    });
  }

  function drawThrChart() {
    const sw = sweep();
    const marker = {
      id: "alThrMarker",
      afterDatasetsDraw(chart) {
        const x = chart.scales.x.getPixelForValue(Math.round(S.thr * 100) - 50);
        const { top, bottom } = chart.chartArea;
        const c = chart.ctx;
        c.save();
        c.strokeStyle = UI.cssVar("--ink-2");
        c.lineWidth = 1.5;
        c.setLineDash([4, 4]);
        c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
        c.setLineDash([]);
        c.font = "600 11px " + (UI.cssVar("--font-body") || "sans-serif");
        const label = "Threshold " + conf(S.thr);
        const w = c.measureText(label).width;
        const tx = x + 8 + w > chart.chartArea.right ? x - 8 - w : x + 8;
        const ty = bottom - 10;
        c.fillStyle = UI.cssVar("--chart-surface");
        c.fillRect(tx - 4, ty - 12, w + 8, 17);
        c.fillStyle = UI.cssVar("--ink-2");
        c.fillText(label, tx, ty);
        c.restore();
      },
    };
    thrChart = UI.chart("al-thr-chart", {
      type: "line",
      data: {
        labels: sw.map((d) => d.t),
        datasets: [
          { label: "Auto-post rate", data: sw.map((d) => d.autoRate), borderColor: UI.series(0), backgroundColor: UI.series(0), stepped: true, tension: 0, clip: false },
          { label: "Accuracy of auto-posted notes", data: sw.map((d) => d.autoAcc), borderColor: UI.series(1), backgroundColor: UI.series(1), stepped: true, tension: 0, spanGaps: false, clip: false },
        ],
      },
      options: {
        scales: {
          y: { min: 0, max: 1, ticks: { callback: UI.pctTick } },
          x: { grid: { display: false }, title: { display: true, text: "Confidence threshold" }, ticks: { autoSkip: false, maxRotation: 0, callback: (v, i) => (i % 10 === 0 || i === 49 ? (i + 50) + "%" : "") } },
        },
        plugins: { tooltip: { callbacks: { title: (items) => "Threshold " + items[0].label + "%", label: (c) => `${c.dataset.label}: ${c.raw == null ? "nothing auto-posts" : pct(c.raw, 1)}` } } },
      },
      plugins: [marker],
    });
  }

  // ---------- refreshers ----------
  function refreshThreshold(root) {
    const m = metrics(S.thr);
    const set = (sel, html) => { const el = root.querySelector(sel); if (el) el.innerHTML = html; };
    const out = root.querySelector("#al-thr-out");
    if (out) out.textContent = conf(S.thr);
    set("#al-thr-mini", thrMiniHtml());
    set("#al-thr-text", thrTextHtml());
    set("#al-headline", headlineHtml(m));
    set("#al-score", scoreHtml(m));
    set("#al-batch-sum", batchSummaryHtml());
    set("#al-table", tableHtml());
    STEPS.forEach((s) => { const el = root.querySelector(`[data-metric="${s.key}"]`); if (el) el.textContent = stepMetric(s.key, m); });
    if (S.step === "route") set("#al-step-detail", stepDetailHtml(m));
    if (S.art === "n8n") { const c = root.querySelector("#al-art-code"); if (c) c.textContent = artifactText(); const mm = root.querySelector("#al-art-meta"); if (mm) mm.textContent = artifactMeta(); }
    renderGov(root);
    refreshOwn(root);
    if (thrChart) thrChart.update("none");
  }
  function refreshOwn(root) {
    const el = root.querySelector("#al-own-out");
    if (el) el.innerHTML = ownHtml();
  }

  function openTrace(id) {
    const r = getRun().find((x) => x.id === id);
    if (!r) return;
    const rt = route(r.val, S.thr);
    const rtm = routeModelOnly(r.raw, S.thr);
    const cmpLine = (c) => c.all ? `<span class="al-ok">✓ Matches reviewer</span>` : `<span class="al-bad">✗ Differs: ${c.miss.map((k) => FIELD_LABEL[k]).join(", ")}</span>`;
    UI.modal({
      title: `${r.id} · trace`,
      body: `
        <div class="row">${UI.tag(OPS.q.marketName(r.note.market))}${UI.tag(OPS.q.planName(r.note.plan))}${UI.tag("Agent " + r.note.agent)}${UI.tag(r.red.total + " identifiers redacted")}</div>
        <span class="label">Redacted note</span><div class="al-doc">${r.red.redHtml}</div>
        <div class="grid g-2">
          <div class="stack"><div class="row between"><span class="label">Model output</span>${routePill(rtm)}</div>${cmpLine(r.rawCmp)}<pre class="code wrap">${UI.esc(jsonView(r.raw))}</pre></div>
          <div class="stack"><div class="row between"><span class="label">After validation</span>${routePill(rt)}</div>${cmpLine(r.finCmp)}<pre class="code wrap">${UI.esc(jsonView(r.val.out))}</pre></div>
        </div>
        <span class="label">Rule log</span>${logHtml(r.val.log)}
        <span class="label">Write-back actions</span>${actionsHtml(r.val.out)}
        <span class="label">Reviewer label</span><pre class="code wrap">${UI.esc(JSON.stringify(r.truth, null, 2))}</pre>`,
      actions: [{ label: "Try this note below", onClick: (close) => { close(); S.ownSrc = r.id; S.ownText = r.note.text; S.live = null; runOwnSim(); const root = document.getElementById("module-root"); if (root) { const sel = root.querySelector("#al-own-src"); if (sel) sel.value = r.id; const ta = root.querySelector("#al-own-text"); if (ta) ta.value = S.ownText; refreshOwn(root); const sec = root.querySelector("#al-h-own"); if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" }); } } }, { label: "Close", primary: true, onClick: (close) => close() }],
    });
  }

  // ---------- live Claude ----------
  function parseJsonLoose(text) {
    const s = String(text || "");
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) throw { code: "bad_json" };
    return JSON.parse(s.slice(a, b + 1));
  }
  async function runLive(root) {
    const red = redact(S.ownText);
    if (red.residual > 0) { S.live = { status: "error", message: "Residual identifiers found after redaction, so the live call was blocked. Edit the note and try again." }; refreshOwn(root); return; }
    S.ownResult = null; runOwnSim();
    const token = ++liveToken;
    liveCtl = typeof AbortController !== "undefined" ? new AbortController() : null;
    S.live = { status: "running", text: "" };
    toggleLiveButtons(root, true);
    refreshOwn(root);
    try {
      const res = await OPS.ai.ask(livePrompt(red.text), {
        signal: liveCtl ? liveCtl.signal : undefined,
        onText: ({ text }) => {
          if (token !== liveToken) return;
          S.live.text = text;
          const el = root.querySelector("#al-live-stream");
          if (el) el.textContent = text || "Thinking…";
        },
      });
      if (token !== liveToken) return;
      let obj;
      try { obj = parseJsonLoose(res && res.text); }
      catch (e) { S.live = { status: "error", message: "Claude's reply was not valid JSON. In production the validator rejects it and the note goes to human review.", text: res && res.text }; return; }
      const val = validate(obj, red.text);
      S.live = { status: "done", raw: obj, val, text: res.text };
    } catch (e) {
      if (token !== liveToken) return;
      const aborted = e && (e.name === "AbortError" || e.code === "cancelled" || e.code === "aborted");
      S.live = { status: "error", message: aborted ? "Stopped. The simulation result is shown instead." : OPS.ai.message(e), text: S.live && S.live.text };
    } finally {
      if (token === liveToken) {
        liveCtl = null;
        toggleLiveButtons(root, false);
        refreshOwn(root);
      }
    }
  }
  function stopLive(root) {
    if (liveCtl) { try { liveCtl.abort(); } catch (e) { /* ignore */ } }
    liveToken++;
    liveCtl = null;
    S.live = { status: "error", message: "Stopped. The simulation result is shown instead." };
    toggleLiveButtons(root, false);
    refreshOwn(root);
  }
  function toggleLiveButtons(root, running) {
    const run = root.querySelector("#al-live-run"), stop = root.querySelector("#al-live-stop");
    if (run) run.disabled = running || !S.liveAvail;
    if (stop) { stop.hidden = !running; if (running) stop.focus(); }
  }

  // ---------- events ----------
  function wire(root, ctx) {
    UI.on(root, "click", "[data-step]", (e, el) => {
      S.step = el.dataset.step;
      root.querySelectorAll("[data-step]").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
      root.querySelector("#al-step-detail").innerHTML = stepDetailHtml(metrics(S.thr));
    });
    UI.on(root, "click", "[data-trace]", (e, el) => openTrace(el.dataset.trace));
    UI.on(root, "click", "[data-opp]", (e, el) => ctx.navigate("pipeline", { focus: el.dataset.opp }));
    UI.on(root, "click", "[data-nav]", (e, el) => ctx.navigate(el.dataset.nav, el.dataset.nav === "roi" ? { opp: "OPP-02" } : { focus: "OPP-02" }));

    const redSel = root.querySelector("#al-red-note");
    redSel.addEventListener("change", () => { S.redNote = redSel.value; root.querySelector("#al-red").innerHTML = redactionHtml(); });

    UI.wireSeg(root, "al-view", (v) => { S.view = v; root.querySelector("#al-batch-sum").innerHTML = batchSummaryHtml(); root.querySelector("#al-table").innerHTML = tableHtml(); });
    UI.wireSeg(root, "al-filter", (v) => { S.filter = v; root.querySelector("#al-table").innerHTML = tableHtml(); });
    root.querySelector("#al-rerun").addEventListener("click", () => {
      clearTimers();
      S.revealed = 0;
      const tbl = root.querySelector("#al-table");
      tbl.innerHTML = tableHtml();
      const tick = () => {
        S.revealed++;
        tbl.innerHTML = tableHtml();
        if (S.revealed < getRun().length) timers.push(setTimeout(tick, 110));
        else { S.revealed = null; UI.toast("Batch complete: 16 notes processed"); }
      };
      timers.push(setTimeout(tick, 150));
    });

    const thr = root.querySelector("#al-thr");
    thr.addEventListener("input", () => { S.thr = Number(thr.value) / 100; refreshThreshold(root); });

    UI.wireSeg(root, "al-art", (v) => {
      S.art = v;
      root.querySelector("#al-art-code").textContent = artifactText();
      root.querySelector("#al-art-code").classList.toggle("wrap", v === "prompt");
      root.querySelector("#al-art-meta").textContent = artifactMeta();
    });
    root.querySelector("#al-copy").addEventListener("click", () => {
      const names = { prompt: "Prompt template", schema: "JSON schema", n8n: "n8n workflow JSON" };
      UI.copy(artifactText(), names[S.art] + " copied");
    });

    const src = root.querySelector("#al-own-src");
    const ta = root.querySelector("#al-own-text");
    src.addEventListener("change", () => {
      S.ownSrc = src.value;
      const n = OPS.data.callNotes.find((x) => x.id === src.value);
      S.ownText = n ? n.text : EXAMPLE_NOTE;
      ta.value = S.ownText;
      S.live = null;
      runOwnSim();
      refreshOwn(root);
    });
    ta.addEventListener("input", () => { S.ownText = ta.value; });
    root.querySelector("#al-own-run").addEventListener("click", () => {
      S.ownText = ta.value;
      if (!S.ownText.trim()) { UI.toast("Add a note first"); return; }
      S.live = null;
      runOwnSim();
      refreshOwn(root);
    });
    root.querySelector("#al-live-run").addEventListener("click", () => {
      S.ownText = ta.value;
      if (!S.ownText.trim()) { UI.toast("Add a note first"); return; }
      runLive(root);
    });
    root.querySelector("#al-live-stop").addEventListener("click", () => stopLive(root));
  }

  function clearTimers() { timers.forEach((t) => clearTimeout(t)); timers = []; }

  OPS.register({
    id: "ailab",
    title: "AI Automation Lab",
    stage: "build",
    order: 10,
    icon: "spark",
    eyebrow: "4 · Build · Prototype of OPP-02",
    summary: "Outreach call notes become a structured disposition and next actions, with PHI redaction before the model, hard safety rules after it, confidence routing, and an evaluation against reviewer labels.",
    jd: [
      "Personally building practical AI-enabled workflows",
      "Attention to validation, adoption, and measurable outcomes",
      "Improve call center productivity through AI-assisted workflows",
      "Hands-on with Claude, n8n and workflow automation",
    ],
    render,
    destroy() {
      clearTimers();
      if (liveCtl) { try { liveCtl.abort(); } catch (e) { /* ignore */ } }
      liveToken++;
      liveCtl = null;
      if (S.live && S.live.status === "running") S.live = null;
      thrChart = null;
    },
  });
})();
