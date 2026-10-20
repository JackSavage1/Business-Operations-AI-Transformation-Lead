/* Throughline — AI bridge (window.OPS.ai).
 *
 * When the page runs inside a claude.ai Artifact viewer that grants the `sample` capability,
 * OPS.ai.ask() sends the prompt to Claude on the viewer's own account. Everywhere else
 * (GitHub Pages, a local file) it is unavailable and modules fall back to their deterministic
 * simulations. Modules must always work without it.
 *
 *   const live = await OPS.ai.available();          // true | false (never throws)
 *   const { text } = await OPS.ai.ask(prompt, { onText: ({ text }) => out.textContent = text });
 *   const obj = await OPS.ai.json(prompt);           // parsed JSON answer
 *   errors reject with { code, message } — code "unavailable" when there is no live model.
 */
(function () {
  "use strict";
  const OPS = (window.OPS = window.OPS || {});
  let samplePromise = null;

  function getSample() {
    if (!samplePromise) {
      samplePromise = (async () => {
        try {
          if (!window.claude || typeof window.claude.use !== "function") return null;
          return (await window.claude.use("sample")) || null;
        } catch (e) {
          return null;
        }
      })();
    }
    return samplePromise;
  }

  const listeners = [];
  let state = "checking"; // checking | live | sim | declined

  function setState(s) {
    state = s;
    listeners.forEach((fn) => { try { fn(s); } catch (e) { /* ignore */ } });
  }

  OPS.ai = {
    get state() { return state; },
    onState(fn) { listeners.push(fn); fn(state); },
    async available() {
      const s = await getSample();
      if (state === "checking") setState(s ? "live" : "sim");
      return !!s && state !== "declined";
    },
    async ask(input, opts = {}) {
      const s = await getSample();
      if (!s || state === "declined") throw { code: "unavailable", message: "Live Claude is not available here; using the built-in simulation." };
      try {
        return await s(input, Object.assign({ modelTier: "quick" }, opts));
      } catch (e) {
        if (e && e.code === "not_granted") setState("declined");
        throw e;
      }
    },
    async json(input, opts = {}) {
      const s = await getSample();
      if (!s || state === "declined") throw { code: "unavailable", message: "Live Claude is not available here; using the built-in simulation." };
      try {
        return await s.json(input, Object.assign({ modelTier: "quick" }, opts));
      } catch (e) {
        if (e && e.code === "not_granted") setState("declined");
        throw e;
      }
    },
    /** human copy for an error code */
    message(e) {
      const code = e && e.code;
      if (code === "unavailable") return "Live Claude isn't available in this view, so the built-in simulation ran instead.";
      if (code === "not_granted") return "Claude access wasn't allowed for this page, so the built-in simulation ran instead.";
      if (code === "rate_limited") return "Too many requests at once. Wait a moment and try again.";
      if (code === "cancelled") return "Stopped.";
      return "Claude couldn't answer this time (" + (code || "error") + "). The simulation result is shown instead.";
    },
  };

  // resolve availability shortly after load so the rail can show status
  setTimeout(() => { OPS.ai.available(); }, 0);
})();
