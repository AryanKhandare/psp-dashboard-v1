/**
 * PSP MES – small UI adjustments.
 *
 * - Adds "Machining" to every stage's Next Department / Next Process list.
 * - The Spraying "cannot switch screens" lock applies only to Spraying operators, not to admins.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] ui-tweaks: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user, isReadOnly, fmt, kpLabel, qtyLabel, stageKeyOf } = window.PSP;
  const MODULE_VERSION = 2;

  const STAGE = "Machining";

  // Add "Machining" to every stage's Next Department / Next Process list (right after Inspection)
  function injectNextStageOptions() {
    ["spraying-complete-next-process", "grinding-complete-next-process", "masking-complete-next-process",
     "masking-next-process", "no-masking-next-process"].forEach(id => {
      const sel = $(id);
      if (!sel || sel.querySelector('option[value="Machining"]')) return;
      const o = document.createElement("option");
      o.value = STAGE;
      o.textContent = STAGE;
      const insp = sel.querySelector('option[value="Inspection"]');
      if (insp) insp.insertAdjacentElement("afterend", o);
      else sel.insertBefore(o, sel.firstChild);
    });
  }

  // Spraying "can't leave the screen" lock: keep it ONLY for Spraying operators.
  // The app sets window.sprayingJobActive whenever a spraying job runs, for every user; admins got locked too.
  // Rework pop-up: add "Post Machining Process" as a reason, shown only when the job is sent back to Machining
  const POST_MACHINING = "Post Machining Process";
  function addPostMachiningReason() {
    const sel = $("rework-reason-select");
    const toEl = $("rework-to-stage");
    const comments = $("rework-custom-input");
    if (!sel || sel.querySelector(`option[value="${POST_MACHINING}"]`)) return;

    const opt = document.createElement("option");
    opt.value = POST_MACHINING;
    opt.textContent = POST_MACHINING;
    const first = sel.querySelector('option[value=""]');
    if (first) first.insertAdjacentElement("afterend", opt); else sel.insertBefore(opt, sel.firstChild);

    const sync = () => {
      const toMachining = String((toEl && toEl.textContent) || "").trim() === STAGE;
      opt.hidden = !toMachining;
      opt.disabled = !toMachining;
      if (!toMachining && sel.value === POST_MACHINING) sel.value = "";
    };
    sync();
    // The app writes the target stage into the pop-up right before opening it
    if (toEl) new MutationObserver(sync).observe(toEl, { childList: true, characterData: true, subtree: true });

    // Comments are required by the form: fill a sensible default for this reason (still editable)
    const AUTO = "Sent to Machining for post machining process";
    sel.addEventListener("change", () => {
      if (!comments) return;
      if (sel.value === POST_MACHINING && !comments.value.trim()) comments.value = AUTO;
      else if (sel.value !== POST_MACHINING && comments.value === AUTO) comments.value = "";
    });
  }

  function limitSprayingLockToOperators() {
    let raw = !!window.sprayingJobActive;
    const isSprayingOperator = () => {
      const u = user();
      if (!u || u.role !== "operator") return false;
      const dept = typeof getCleanDeptKey === "function" ? getCleanDeptKey(u.department) : u.department;
      return String(dept || "").toLowerCase().includes("spray");
    };
    try {
      Object.defineProperty(window, "sprayingJobActive", {
        configurable: true,
        get() { return raw && isSprayingOperator(); },
        set(v) { raw = !!v; }
      });
    } catch (e) { console.warn("[UI Tweaks] Could not adjust spraying lock:", e); }
  }

  // ===================== BOOT =====================
  try {
    injectNextStageOptions();
    limitSprayingLockToOperators();
    addPostMachiningReason();
    console.log("[PSP] ui-tweaks v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] ui-tweaks failed to load:", err);
  }
})();
