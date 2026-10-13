/**
 * PSP MES – Operator names chosen by people, not by the dashboard.
 *
 * 1) Turns off automatic operator assignment (autoAssignPendingJobs / checkAndAutoForwardJobs).
 *    They gave waiting jobs a rotation name and even replaced names typed via "Others".
 *    Now a job has no operator until someone starts it, and the chosen name is never overwritten.
 * 2) Once per session (super admin / production admin): clears the auto-assigned names from jobs that
 *    have not been started yet (Pending) in Masking, Spraying, Grinding and Polishing.
 * 3) Start Grinding pop-up gets an "Operator Name" field (type or pick). The chosen name is saved for the whole
 *    Grinding cycle (start, pause, resume, end) instead of the logged-in account's email.
 *
 * Load after the other add-ons (it wraps sendBackendPost), before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] operator-choice: psp-common.js must load first."); return; }
  const { $, esc, allJobs, user } = window.PSP;
  const MODULE_VERSION = 1;
  const PROD_STAGES = { Masking: "masking", Spraying: "spraying", Grinding: "grinding", Polishing: "polishing" };

  // ---------- 1) no automatic assignment ----------
  function disableAutoAssignment() {
    window.autoAssignPendingJobs = function () { /* turned off: operators are chosen when a job is started */ };
    window.checkAndAutoForwardJobs = function () { /* turned off: no automatic re-assignment */ };
  }

  // ---------- 2) clear auto-assigned names on jobs that have not been started ----------
  let cleared = false;
  async function clearAutoNamesOnce() {
    if (cleared) return;
    const u = user();
    if (!u || !["super_admin", "production_admin"].includes(u.role)) return;
    if (typeof _initialFirestoreLoadComplete !== "undefined" && !_initialFirestoreLoadComplete) return;
    if (typeof isMockMode === "function" && isMockMode()) return;
    const list = allJobs();
    if (!list.length) return;
    cleared = true;

    const targets = [];
    list.forEach(job => {
      const key = PROD_STAGES[job.currentDepartment];
      const sd = key && job[key];
      if (!sd || !sd.operatorName) return;
      const st = sd.status || "Pending";
      if (st === "In Progress" || st === "Hold" || st === "Completed") return; // started: keep the real name
      targets.push({ job, key });
    });
    if (!targets.length) return;

    targets.forEach(t => { t.job[t.key].operatorName = ""; });
    if (typeof renderAll === "function") renderAll();
    try {
      const db = firebase.firestore();
      for (let i = 0; i < targets.length; i += 400) {
        const batch = db.batch();
        targets.slice(i, i + 400).forEach(t => {
          if (t.job.id) batch.update(db.collection("jobs").doc(t.job.id), { [`${t.key}.operatorName`]: "" });
        });
        await batch.commit();
      }
      console.log(`[Operator Choice] Cleared auto-assigned operator on ${targets.length} job(s) that have not been started.`);
    } catch (e) {
      console.warn("[Operator Choice] Could not clear auto-assigned names:", e && e.message ? e.message : e);
    }
  }

  // ---------- 3) operator field in Start Grinding ----------
  function grindingOperatorNames() {
    const names = new Set();
    try { (typeof getOperatorsForDepartment === "function" ? getOperatorsForDepartment("Grinding") : []).forEach(n => n && names.add(String(n).trim())); } catch (e) {}
    allJobs().forEach(j => { const n = j.grinding && j.grinding.operatorName; if (n && !String(n).includes("@")) names.add(String(n).trim()); });
    return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  function addGrindingOperatorField() {
    const form = $("grinding-start-form");
    if (!form || $("grinding-operator-input")) return;
    const group = document.createElement("div");
    group.className = "form-group";
    group.innerHTML = `
      <label for="grinding-operator-input" style="font-weight: bold; margin-bottom: 5px; display: block;">Operator Name *</label>
      <input type="text" id="grinding-operator-input" list="grinding-operator-list" class="form-input"
             style="height: 50px; font-size: 16px; width: 100%;" placeholder="Type or pick the operator doing this job" required autocomplete="off">
      <datalist id="grinding-operator-list"></datalist>`;
    const actions = form.querySelector(".form-actions");
    if (actions) form.insertBefore(group, actions); else form.appendChild(group);

    // Fresh list and sensible default each time the pop-up opens
    const modal = $("modal-start-grinding");
    if (modal) {
      new MutationObserver(() => {
        if (!modal.classList.contains("active")) return;
        const dl = $("grinding-operator-list");
        if (dl) dl.innerHTML = grindingOperatorNames().map(n => `<option value="${esc(n)}"></option>`).join("");
        const inp = $("grinding-operator-input");
        const u = user();
        if (inp) inp.value = (u && u.role === "operator" && u.name) ? u.name : "";
      }).observe(modal, { attributes: true, attributeFilter: ["class", "style"] });
    }
  }

  // The app sends the logged-in email as the operator for Grinding; use the chosen name instead
  function useChosenGrindingOperator() {
    if (typeof window.sendBackendPost !== "function") return;
    const orig = window.sendBackendPost;
    window.sendBackendPost = function (payload) {
      try {
        const type = String((payload && (payload.type || payload.action)) || "").toUpperCase().replace(/_/g, "");
        const stage = payload && payload.stage;
        if (stage === "Grinding" && ["STARTCYCLE", "PAUSECYCLE", "RESUMECYCLE", "ENDCYCLE", "SPLITSTAGE"].includes(type)) {
          const job = allJobs().find(j => j.kpNumber === payload.kpNo);
          let name = "";
          if (type === "STARTCYCLE") {
            const inp = $("grinding-operator-input");
            name = inp ? inp.value.trim() : "";
          }
          if (!name && job && job.grinding && job.grinding.operatorName && !String(job.grinding.operatorName).includes("@")) {
            name = job.grinding.operatorName;
          }
          if (name) {
            payload.operatorName = name;
            if (job) { job.grinding = job.grinding || {}; job.grinding.operatorName = name; }
          }
        }
      } catch (e) { console.warn("[Operator Choice] grinding operator:", e); }
      return orig.apply(this, arguments);
    };
  }

  function installHooks() {
    if (typeof window.executeRenderAll === "function") {
      const orig = window.executeRenderAll;
      window.executeRenderAll = function () {
        const r = orig.apply(this, arguments);
        try { clearAutoNamesOnce(); } catch (e) {}
        return r;
      };
    }
  }

  // ===================== BOOT =====================
  try {
    disableAutoAssignment();
    addGrindingOperatorField();
    useChosenGrindingOperator();
    installHooks();
    console.log("[PSP] operator-choice v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] operator-choice failed to load:", err);
  }
})();
