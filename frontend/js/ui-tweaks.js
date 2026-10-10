/**
 * PSP MES – small UI adjustments.
 *
 * - Adds "Machining" to every stage's Next Department / Next Process list.
 * - The Spraying "cannot switch screens" lock applies only to Spraying operators, not to admins.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] ui-tweaks: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user, isReadOnly, fmt, kpLabel, qtyLabel, stageKeyOf } = window.PSP;
  const MODULE_VERSION = 1;

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
    console.log("[PSP] ui-tweaks v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] ui-tweaks failed to load:", err);
  }
})();
