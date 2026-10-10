/**
 * PSP MES – Job creation guards.
 *
 * 1) A deleted job is never re-created (the app's CREATE_JOB overwrites with set()).
 * 2) An existing job is never overwritten.
 * 3) The sheet auto-sync only adds NEW jobs to Inspection; later stages are reached through the dashboard.
 * 4) REGISTER CARD may bring back a previously deleted KP on purpose; an already-active KP shows a message.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] job-guards: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user, isReadOnly, fmt, kpLabel, qtyLabel, stageKeyOf } = window.PSP;
  const MODULE_VERSION = 1;

  // ---- Guards for job creation (sheet auto-sync and Register Card) ----
  // 1) Never re-create a job that exists in Firebase (deleted or not): the app's CREATE_JOB uses set(),
  //    which would overwrite it and wipe the "deleted" mark.
  // 2) Sheet auto-sync may only add NEW jobs to Inspection. Later stages are reached through the dashboard.
  const blockedCreates = new Map(); // KP -> reason, remembered for this session (saves Firebase reads)
  async function shouldBlockCreate(payload) {
    const kp = String(payload.kpNo || "").trim();
    if (!kp) return "";
    if (blockedCreates.has(kp)) return blockedCreates.get(kp);
    const target = payload.currentDepartment || "Inspection";
    if (target !== "Inspection") {
      const why = `new jobs are only added to Inspection (sheet said ${target})`;
      blockedCreates.set(kp, why);
      return why;
    }
    const remember = why => { if (why) blockedCreates.set(kp, why); return why; };
    try {
      const deleted = window.deletedJobs;
      if (deleted && deleted.has && deleted.has(kp.toLowerCase())) return remember("job was deleted");
      const db = firebase.firestore();
      const byId = await db.collection("jobs").doc(`job_${kp}`).get();
      if (byId.exists) return remember(byId.data().isDeleted === true ? "job was deleted" : "job already exists");
      const byKp = await db.collection("jobs").where("kpNumber", "==", kp).limit(1).get();
      if (!byKp.empty) return remember(byKp.docs[0].data().isDeleted === true ? "job was deleted" : "job already exists");
    } catch (e) {
      console.warn("[Job Guards] Could not check existing job for", kp, e && e.message ? e.message : e);
    }
    return "";
  }

  // Returns the Firebase data of a job with this KP that is NOT deleted, or null
  async function findActiveJob(kpNo) {
    const kp = String(kpNo || "").trim();
    if (!kp) return null;
    try {
      const db = firebase.firestore();
      const byId = await db.collection("jobs").doc(`job_${kp}`).get();
      if (byId.exists && byId.data().isDeleted !== true) return byId.data();
      const byKp = await db.collection("jobs").where("kpNumber", "==", kp).get();
      const live = byKp.docs.find(d => d.data().isDeleted !== true);
      return live ? live.data() : null;
    } catch (e) {
      console.warn("[Job Guards] Could not check active job for", kp, e && e.message ? e.message : e);
      return null;
    }
  }

  // Auto-sync adds the job to the screen before saving; remove it again when the save is skipped
  function dropLocalPhantom(kp) {
    const list = allJobs();
    for (let i = list.length - 1; i >= 0; i--) {
      const j = list[i];
      if (j && j.kpNumber === kp && !j.id) list.splice(i, 1);
    }
    if (typeof renderAll === "function") renderAll();
  }

  // ===================== HOOKS =====================
  function installHooks() {
    if (typeof window.sendBackendPost !== "function") return;
    const origSend = window.sendBackendPost;
    window.sendBackendPost = async function (payload) {
      const type = String((payload && (payload.type || payload.action)) || "").toUpperCase().replace(/_/g, "");
      if (type === "CREATEJOB" && !(typeof isMockMode === "function" && isMockMode())) {
        // REGISTER CARD sends no target stage; the sheet auto-sync always does
        const isManualRegister = !Object.prototype.hasOwnProperty.call(payload, "currentDepartment");
        if (isManualRegister) {
          const active = await findActiveJob(payload.kpNo);
          if (active) {
            dropLocalPhantom(payload.kpNo);
            alert(`${payload.kpNo} is already active in ${active.currentStage || "a stage"}. It was not registered again.`);
            return { success: true, skipped: "already active" };
          }
          // A previously deleted KP may be registered again on purpose: allow it and unblock it
          const k = String(payload.kpNo || "").trim();
          blockedCreates.delete(k);
          if (window.deletedJobs && window.deletedJobs.delete) window.deletedJobs.delete(k.toLowerCase());
          try { localStorage.setItem("psp_deleted_jobs", JSON.stringify(Array.from(window.deletedJobs || []))); } catch (e) {}
          console.log(`[Job Guards] Register Card: ${k} registered in Inspection.`);
          return origSend.apply(this, arguments);
        }
        const blocked = await shouldBlockCreate(payload);
        if (blocked) {
          dropLocalPhantom(payload.kpNo);
          console.log(`[Job Guards] Skipped creating ${payload.kpNo}: ${blocked}`);
          return { success: true, skipped: blocked };
        }
      }
      return origSend.apply(this, arguments);
    };
  }

  // ===================== BOOT =====================
  try {
    installHooks();
    console.log("[PSP] job-guards v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] job-guards failed to load:", err);
  }
})();
