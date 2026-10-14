/**
 * PSP MES – Inspection form required before a job leaves Inspection.
 *
 * When a job is moved from Inspection to any stage (Select Next Stage screen, or drag on the
 * Inspection page board), the move pauses and the inspection Google Form opens inside the dashboard.
 * After the form is submitted, "Form submitted – continue move" completes the move (normal UNDO banner).
 * Cancel keeps the job in Inspection. Super Admin can skip the form.
 * The submission time and user are saved on the job (inspectionForm) and in the audit log.
 *
 * The automatic move from the sheet (pre-inspection Done) does not go through here.
 * Load after the other add-ons, before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] inspection-form: psp-common.js must load first."); return; }
  const { $, esc, allJobs, user } = window.PSP;
  const MODULE_VERSION = 1;

  // ===================== CONFIG =====================
  const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSeiluE6bdhxyuI8Z4VG9nDLyqAlPCcMQBXqy3GBbKGzoSS5JA/viewform";
  // Optional: pre-fill the KP number in the form. Put the KP question's entry id here, e.g. "entry.123456789"
  // (Google Form → ⋮ → Get pre-filled link → type KP-TEST in the KP question → Get link → copy the "entry.…" part).
  const KP_ENTRY_ID = "";
  const FROM_STAGE = "Inspection";

  function formUrlFor(kp) {
    const params = new URLSearchParams({ embedded: "true" });
    if (KP_ENTRY_ID) { params.set("usp", "pp_url"); params.set(KP_ENTRY_ID, kp); }
    return FORM_URL + "?" + params.toString();
  }

  // ===================== UI =====================
  function injectModal() {
    if ($("psp-insp-form-modal")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="psp-insp-form-modal" style="display:none; position:fixed; inset:0; z-index:12000; background:rgba(15,23,42,0.88);
           backdrop-filter:blur(6px); align-items:center; justify-content:center; padding:12px;">
        <div style="background:var(--bg-card, #fff); color:var(--text-main, #0f172a); width:100%; max-width:820px; height:100%;
             max-height:94vh; border-radius:12px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 20px 40px rgba(0,0,0,.5);">
          <div style="padding:12px 16px; border-bottom:1px solid var(--border-color, #cbd5e1); display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div>
              <div style="font-weight:800; font-size:15px;">📝 Inspection Form</div>
              <div id="psp-insp-form-sub" style="font-size:12px; opacity:.8;"></div>
            </div>
            <button type="button" id="psp-insp-form-cancel" class="btn btn-secondary btn-xs" style="height:32px; padding:0 12px;">✕ Cancel</button>
          </div>
          <div id="psp-insp-form-note" style="padding:8px 16px; font-size:12px; background:rgba(59,130,246,.12); color:#2563eb; font-weight:600;"></div>
          <iframe id="psp-insp-form-frame" title="Inspection form" style="flex:1; width:100%; border:0; background:#fff;"></iframe>
          <div style="padding:10px 16px; border-top:1px solid var(--border-color, #cbd5e1); display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end;">
            <button type="button" id="psp-insp-form-skip" class="btn btn-secondary btn-xs" style="height:40px; padding:0 14px; display:none;">Skip form (Super Admin)</button>
            <button type="button" id="psp-insp-form-continue" class="btn btn-success" style="height:40px; padding:0 18px; font-weight:700;" disabled>
              Submit the form above first</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);
  }

  // ===================== FLOW =====================
  let active = null; // { job, target, transition, loads }

  function openForm(job, target, transition) {
    const modal = $("psp-insp-form-modal"), frame = $("psp-insp-form-frame");
    active = { job, target, transition, loads: 0 };
    $("psp-insp-form-sub").textContent = `${job.kpNumber} · ${job.partName || ""} → moving to ${target}`;
    $("psp-insp-form-note").textContent = `Fill in the inspection form for ${job.kpNumber} and press Submit inside the form. The move continues after that.`;
    const cont = $("psp-insp-form-continue");
    cont.disabled = true;
    cont.textContent = "Submit the form above first";
    const u = user();
    $("psp-insp-form-skip").style.display = (u && u.role === "super_admin") ? "" : "none";
    frame.src = formUrlFor(job.kpNumber);
    modal.style.display = "flex";
  }

  function closeForm() {
    const modal = $("psp-insp-form-modal"), frame = $("psp-insp-form-frame");
    if (modal) modal.style.display = "none";
    if (frame) frame.src = "about:blank";
  }

  function cancelMove() {
    closeForm();
    active = null;
    // Leave the job in Inspection: close the Select Next Stage screen too
    const overlay = $("transition-drag-overlay");
    if (overlay) overlay.style.display = "none";
    window.pendingTransition = null;
    try { if (typeof renderAll === "function") renderAll(); } catch (e) {}
  }

  async function recordSubmission(job, skipped) {
    const u = user() || {};
    const by = u.name || u.email || "Unknown";
    const at = new Date().toISOString();
    try {
      if (typeof createAuditLog === "function") {
        createAuditLog(u.email || by, job.kpNumber, skipped ? "Inspection form SKIPPED by Super Admin before moving out of Inspection"
                                                            : "Inspection form submitted before moving out of Inspection");
      }
    } catch (e) {}
    if (typeof isMockMode === "function" && isMockMode()) return;
    try {
      const db = firebase.firestore();
      const ref = job.id ? db.collection("jobs").doc(job.id) : db.collection("jobs").doc("job_" + job.kpNumber);
      await ref.update({ inspectionForm: { submittedAt: at, by, skipped: !!skipped } });
    } catch (e) { console.warn("[Inspection Form] could not save the submission note:", e && e.message ? e.message : e); }
  }

  function continueMove(skipped, orig) {
    if (!active) return;
    const { job, target, transition } = active;
    active = null;
    closeForm();
    recordSubmission(job, skipped);
    window.pendingTransition = transition;   // restore the paused move and complete it
    orig(target);
  }

  function bindEvents(origRef) {
    const frame = $("psp-insp-form-frame");
    // The form page loads once; every further load means the form was submitted (or moved to its next section)
    frame.addEventListener("load", () => {
      if (!active || !frame.src || frame.src === "about:blank") return;
      active.loads += 1;
      if (active.loads >= 2) {
        const cont = $("psp-insp-form-continue");
        cont.disabled = false;
        cont.textContent = "✅ Form submitted – continue move";
        $("psp-insp-form-note").textContent = "If the form shows \"Your response has been recorded\", click the green button to complete the move.";
      }
    });
    $("psp-insp-form-cancel").addEventListener("click", cancelMove);
    $("psp-insp-form-continue").addEventListener("click", () => continueMove(false, origRef()));
    $("psp-insp-form-skip").addEventListener("click", () => {
      if (confirm("Skip the inspection form for this move? This is recorded in the audit log.")) continueMove(true, origRef());
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && $("psp-insp-form-modal").style.display === "flex") cancelMove();
    });
  }

  // Every move out of Inspection goes through applyStageTransitionWithUndo with pendingTransition.stage === "Inspection"
  function installHook() {
    if (typeof window.applyStageTransitionWithUndo !== "function") return null;
    const orig = window.applyStageTransitionWithUndo;
    window.applyStageTransitionWithUndo = function (targetStage) {
      const tr = window.pendingTransition;
      if (tr && tr.stage === FROM_STAGE && tr.job && targetStage && targetStage !== FROM_STAGE) {
        openForm(tr.job, targetStage, tr);
        return;
      }
      return orig.apply(this, arguments);
    };
    return orig;
  }

  // ===================== BOOT =====================
  try {
    injectModal();
    const orig = installHook();
    bindEvents(() => orig);
    console.log("[PSP] inspection-form v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] inspection-form failed to load:", err);
  }
})();
