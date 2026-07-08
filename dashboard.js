
// ── TAT (Turn Around Time) Tracking Utilities ──────────────────────────────
const _tatAlertedJobs = new Set(); // Session-level: prevents repeated red-alert toasts

/**
 * Calculate TAT percentage elapsed for a job.
 * Returns 0-100+ value (can exceed 100 if overdue).
 * Only applies to production stages: Masking, Spraying, Grinding, Polishing.
 */
function calcTATPct(job) {
  if (!job.inspectionDate || !job.plannedCompletionDate) return -1;
  const start = new Date(job.inspectionDate);
  const end = new Date(job.plannedCompletionDate);
  const now = new Date();
  const totalMs = end.getTime() - start.getTime();
  if (totalMs <= 0) return 100;
  const elapsedMs = now.getTime() - start.getTime();
  return Math.round((elapsedMs / totalMs) * 100);
}

function checkAndAutoForwardJobs() {
  // 1. Only admins run system-level forwarding checks
  if (!currentUser || (currentUser.role !== "super_admin" && currentUser.role !== "production_admin")) {
    return;
  }

  const prodStages = ["Masking", "Spraying", "Grinding", "Polishing"];
  const now = new Date();
  let updated = false;
  if (!Array.isArray(jobs)) return;

  // Initialize session tracking set if not exists
  window._forwardedKPsInSession = window._forwardedKPsInSession || new Set();

  jobs.forEach(job => {
    if (!prodStages.includes(job.currentDepartment)) return;
    const stageKey = job.currentDepartment.toLowerCase().replace(/[^a-z]/g, "");
    if (!job[stageKey] || job[stageKey].status !== "Pending") return;

    let arrivalTimeStr = job.stageAssignedAt && job.stageAssignedAt[stageKey];
    if (!arrivalTimeStr) {
      job.stageAssignedAt = job.stageAssignedAt || {};
      job.stageAssignedAt[stageKey] = now.toISOString();
      arrivalTimeStr = job.stageAssignedAt[stageKey];
      job[stageKey].queueEntryTime = arrivalTimeStr;
      updated = true;
    }

    const elapsedMs = now - new Date(arrivalTimeStr);
    const limitMs = getStageStartLimitMs(job.currentDepartment);

    // If no limit is assigned (like Grinding/Polishing), skip auto-forwarding checks
    if (limitMs === null) return;

    if (elapsedMs >= limitMs) {
      const trackingKey = `${job.kpNumber}_${stageKey}`;
      if (window._forwardedKPsInSession.has(trackingKey)) {
        return; // Prevent duplicate forwarding attempts for same job/stage in this session
      }
      window._forwardedKPsInSession.add(trackingKey);

      const currentOp = job[stageKey].operatorName || "";
      const nextOp = getNextOperatorForDepartment(currentOp, job.currentDepartment);
      
      job[stageKey].operatorName = nextOp;
      job.stageAssignedAt[stageKey] = now.toISOString();
      job[stageKey].queueEntryTime = now.toISOString();
      updated = true;
      
      createAuditLog("System", job.currentDepartment, job.kpNumber, "Auto-Forwarded", 
        `Job auto-forwarded from ${currentOp || "unassigned"} to ${nextOp} (time limit of ${limitMs / 3600000}h exceeded).`);
      
      if (currentOp) {
        recordLateStartPenalty(currentOp, job.currentDepartment, job.kpNumber);
      }
      
      if (!isMockMode() && job.id) {
        const db = firebase.firestore();
        const updates = {};
        updates[`${stageKey}.operatorName`] = nextOp;
        updates[`stageAssignedAt.${stageKey}`] = job.stageAssignedAt[stageKey];
        updates[`${stageKey}.queueEntryTime`] = job.stageAssignedAt[stageKey];
        db.collection("jobs").doc(job.id).update(updates).catch(e => {
          console.warn("Firestore auto-forward write failed:", e.message || e);
          handleFirestoreError("auto-forward-write", e);
        });
      }
    }
  });

  if (updated && isMockMode()) {
    saveState();
    renderAll();
  }
}

function getLoggedOperatorName() {
  if (!currentUser) return "";
  if (currentUser.name && currentUser.name.trim() !== "") {
    return currentUser.name.trim();
  }
  if (currentUser.email) {
    return currentUser.email.split("@")[0];
  }
  return "";
}

function updateCardCountdownTimers() {
  const elements = document.querySelectorAll(".tat-countdown-container");
  elements.forEach(el => {
    const kpNo = el.getAttribute("data-kp");
    const job = jobs.find(j => j.kpNumber === kpNo);
    if (!job) return;
    
    const prodStages = ["Masking", "Spraying", "Grinding", "Polishing"];
    if (!prodStages.includes(job.currentDepartment)) return;
    
    const stageKey = job.currentDepartment.toLowerCase().replace(/[^a-z]/g, "");
    const arrivalTimeStr = job.stageAssignedAt && job.stageAssignedAt[stageKey];
    if (!arrivalTimeStr) return;
    
    const arrivalTime = new Date(arrivalTimeStr);
    const now = new Date();
    const limitMs = getStageStartLimitMs(job.currentDepartment);
    
    const elapsedMs = now - arrivalTime;
    
    const labelEl = el.querySelector(".tat-timer-label");
    const valueEl = el.querySelector(".tat-timer-value");
    if (!labelEl || !valueEl) return;
    
    // Format arrival time nicely (HH:MM)
    const timeStr = arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    labelEl.textContent = `Arrived: ${timeStr}`;
    
    if (job[stageKey] && job[stageKey].status !== "Pending") {
      // Started
      if (job[stageKey].startTime) {
        const start = new Date(job[stageKey].startTime);
        const tookMs = start - arrivalTime;
        const tookHours = Math.floor(tookMs / 3600000);
        const tookMins = Math.floor((tookMs % 3600000) / 60000);
        valueEl.textContent = `⏱ Started in ${tookHours}h ${tookMins}m`;
        valueEl.style.color = "var(--status-completed)";
        valueEl.style.animation = "none";
      } else {
        valueEl.textContent = `⏱ Active`;
        valueEl.style.color = "var(--text-highlight)";
        valueEl.style.animation = "none";
      }
    } else {
      // Pending
      if (limitMs === null) {
        // No limit assigned, just show elapsed time since arrival
        const hours = Math.floor(elapsedMs / 3600000);
        const mins = Math.floor((elapsedMs % 3600000) / 60000);
        valueEl.textContent = `⏱ Waiting ${hours}h ${mins}m`;
        valueEl.style.color = "var(--text-muted)";
        valueEl.style.animation = "none";
      } else {
        const remainingMs = limitMs - elapsedMs;
        if (remainingMs > 0) {
          const h = Math.floor(remainingMs / 3600000);
          const m = Math.floor((remainingMs % 3600000) / 60000);
          valueEl.textContent = `⏱ Start in ${h}h ${m}m`;
          if (remainingMs < 60 * 60 * 1000) {
            valueEl.style.color = "var(--status-pending)";
            valueEl.style.animation = "pulse-text-orange 1s infinite alternate";
          } else {
            valueEl.style.color = "var(--text-muted)";
            valueEl.style.animation = "none";
          }
        } else {
          const overMs = Math.abs(remainingMs);
          const h = Math.floor(overMs / 3600000);
          const m = Math.floor((overMs % 3600000) / 60000);
          valueEl.textContent = `⚠️ Overdue by ${h}h ${m}m`;
          valueEl.style.color = "var(--status-hold)";
          valueEl.style.animation = "pulse-text-red 1s infinite alternate";
        }
      }
    }
  });
}

async function syncMaskingQueueFromBackend() {
  try {
    const response = await fetch(scriptUrl + "?process=MASKING");
    if (!response.ok) throw new Error("HTTP error " + response.status);
    const backendJobs = await response.json();
    console.log("Fetched masking queue from backend:", backendJobs);
    
    let updated = false;
    backendJobs.forEach(bj => {
      let localJob = jobs.find(j => j.kpNumber === bj.kpNo);
      if (localJob) {
        if (!localJob.rowIndex) {
          localJob.rowIndex = bj.rowIndex;
          updated = true;
        }
      } else {
        // Add new job from backend
        const newJob = {
          kpNumber: bj.kpNo,
          partName: bj.materialName || "Unknown Part",
          customer: bj.customerName || "Unknown Customer",
          quantity: Number(bj.qty) || 1,
          processType: bj.jcNo || "Plasma",
          priority: "Normal",
          inspectionDate: new Date().toISOString().split('T')[0],
          receivedDate: new Date().toISOString().split('T')[0],
          currentDepartment: "Masking",
          status: "Pending",
          rowIndex: bj.rowIndex,
          masking: {
            operatorName: "",
            shift: "",
            status: "Pending",
            startTime: null,
            endTime: null,
            durationMs: 0,
            activeTimeMs: 0,
            lastStartedAt: null,
            lastPausedAt: null,
            holdHistory: [],
            materials: []
          },
          spraying: { status: "Pending" },
          grinding: { status: "Pending" },
          polishing: { status: "Pending" },
          finalInspection: { status: "Pending" },
          dispatch: { status: "Pending" }
        };
        jobs.push(newJob);
        updated = true;
      }
    });

    if (updated) {
      saveState();
      renderAll();
    }
  } catch (err) {
    console.warn("Could not sync masking queue from backend (offline?):", err);
  }
}


function initTheme() {
  const currentTheme = localStorage.getItem("mes_theme") || "dark";
  const icon = document.getElementById("theme-toggle-icon");
  const text = document.getElementById("theme-toggle-text");
  
  if (currentTheme === "light") {
    document.body.classList.add("light-theme");
    if (icon) icon.textContent = "🌙";
    if (text) text.textContent = "DARK";
  } else {
    document.body.classList.remove("light-theme");
    if (icon) icon.textContent = "☀️";
    if (text) text.textContent = "LIGHT";
  }
}

function toggleTheme() {
  const isLight = document.body.classList.toggle("light-theme");
  localStorage.setItem("mes_theme", isLight ? "light" : "dark");
  initTheme();
  createAuditLog("System", null, `Theme mode switched to ${isLight ? 'Light Mode' : 'Dark Mode'}`);
}

// 1. STATE & STORAGE MANAGEMENT
// 1. STATE & STORAGE MANAGEMENT & FIRESTORE EVENT STREAM

async function sendBackendPost(payload) {
  const isMock = isMockMode();
  if (isMock) {
    console.log("Mock Mode POST:", payload);
    return { success: true };
  }
  
  try {
    const db = firebase.firestore();
    const reqType = String(payload.type || payload.action || "").trim().toUpperCase();
    
    let jobRef = null;
    let jobData = null;
    if (payload.kpNo && payload.kpNo !== "N/A") {
      const snap = await db.collection("jobs").where("kpNumber", "==", payload.kpNo).get();
      if (!snap.empty) {
        jobRef = snap.docs[0].ref;
        jobData = snap.docs[0].data();
      }
    }
    
    // 1. START CYCLE
    if (reqType === "START_CYCLE" || reqType === "STARTCYCLE") {
      if (!jobRef) throw new Error(`Job ${payload.kpNo} not found`);
      
      const stageKey = payload.stage.toLowerCase().replace(/[^a-z]/g, "");
      const stageData = jobData[stageKey] || {};
      
      stageData.status = "In Progress";
      stageData.operatorName = payload.operatorName || "";
      stageData.shift = payload.shift || "";
      stageData.startTime = payload.startTime || new Date().toISOString();
      stageData.lastStartedAt = payload.startTime || new Date().toISOString();
      stageData.holdHistory = payload.holdHistory || [];
      
      // Copy all additional payload fields to stageData dynamically
      for (const [key, value] of Object.entries(payload)) {
        if (!["type", "kpNo", "stage", "operatorName", "shift", "startTime", "lastStartedAt", "holdHistory"].includes(key)) {
          stageData[key] = value;
        }
      }
      
      const updateFields = {
        currentStatus: "In Progress",
        assignedOperator: { uid: currentUser?.uid || "", name: payload.operatorName || "" },
        shift: payload.shift || "",
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        [stageKey]: stageData
      };
      
      if (payload.storeLocation) {
        updateFields.storeLocation = payload.storeLocation;
      }
      
      await jobRef.update(updateFields);
      
      await createFirestoreAuditLog(payload.operatorName, payload.stage, payload.kpNo, "Cycle Started", `Commenced ${payload.stage} process on ${payload.shift || "A Shift"}`);
      return { success: true };
    }
    
    // 2. PAUSE CYCLE
    if (reqType === "PAUSE_CYCLE" || reqType === "PAUSECYCLE") {
      if (!jobRef) throw new Error(`Job ${payload.kpNo} not found`);
      
      const stageKey = payload.stage.toLowerCase().replace(/[^a-z]/g, "");
      const stageData = jobData[stageKey] || {};
      
      stageData.status = "Hold";
      stageData.activeTimeMs = Number(payload.activeTimeMs || 0);
      stageData.holdHistory = payload.holdHistory || [];
      stageData.lastPausedAt = new Date().toISOString();
      if (payload.holdReason) {
        stageData.remarks = payload.remarks || "";
        stageData.holdReason = payload.holdReason;
      }
      
      await jobRef.update({
        currentStatus: "Hold",
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        [stageKey]: stageData
      });
      
      await createFirestoreAuditLog(payload.operatorName, payload.stage, payload.kpNo, "Cycle Paused", `Put on Hold (Reason: ${payload.holdReason || "N/A"}. Remarks: ${payload.remarks || ""})`);
      return { success: true };
    }
    
    // 3. RESUME CYCLE
    if (reqType === "RESUME_CYCLE" || reqType === "RESUMECYCLE") {
      if (!jobRef) throw new Error(`Job ${payload.kpNo} not found`);
      
      const stageKey = payload.stage.toLowerCase().replace(/[^a-z]/g, "");
      const stageData = jobData[stageKey] || {};
      
      stageData.status = "In Progress";
      stageData.holdHistory = payload.holdHistory || [];
      stageData.lastStartedAt = new Date().toISOString();
      
      await jobRef.update({
        currentStatus: "In Progress",
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        [stageKey]: stageData
      });
      
      await createFirestoreAuditLog(payload.operatorName, payload.stage, payload.kpNo, "Cycle Resumed", "Job returned to active state");
      return { success: true };
    }
    
    // 4. END CYCLE
    if (reqType === "END_CYCLE" || reqType === "ENDCYCLE") {
      if (!jobRef) throw new Error(`Job ${payload.kpNo} not found`);
      
      const stageKey = payload.stage.toLowerCase().replace(/[^a-z]/g, "");
      const stageData = jobData[stageKey] || {};
      
      stageData.status = "Completed";
      stageData.endTime = payload.endTime || new Date().toISOString();
      stageData.activeTimeMs = Number(payload.activeTimeMs || 0);
      stageData.holdHistory = payload.holdHistory || [];
      
      // Store additional spraying metadata if present
      if (payload.batchId !== undefined) stageData.batchId = payload.batchId;
      if (payload.processedQty !== undefined) stageData.processedQty = Number(payload.processedQty);
      if (payload.totalPasses !== undefined) stageData.totalPasses = Number(payload.totalPasses);
      if (payload.finalTemp !== undefined) stageData.finalTemp = payload.finalTemp;
      if (payload.finalThickness !== undefined) stageData.finalThickness = payload.finalThickness;
      if (payload.finalSize !== undefined) stageData.finalSize = payload.finalSize;
      if (payload.powderConsumed !== undefined) stageData.powderConsumed = payload.powderConsumed;
      if (payload.location !== undefined) stageData.location = payload.location;
      if (payload.operatorName !== undefined) stageData.operatorName = payload.operatorName;
      if (payload.sprayingBooth !== undefined) stageData.sprayingBooth = payload.sprayingBooth;
      
      const nextStage = payload.nextStage || "Spraying";
      const nextStageKey = nextStage.toLowerCase().replace(/[^a-z]/g, "");
      
      const updates = {
        currentStage: nextStage,
        currentStatus: nextStage === "Dispatched" ? "Completed" : "Pending",
        assignedOperator: null,
        shift: "",
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        splitRemark: "",
        [stageKey]: stageData,
        [`stageAssignedAt.${nextStageKey}`]: new Date().toISOString()
      };
      
      if (nextStage !== "Dispatched") {
        const nextStageData = jobData[nextStageKey] || { status: "Pending" };
        nextStageData.status = "Pending";
        nextStageData.queueEntryTime = new Date().toISOString();
        updates[nextStageKey] = nextStageData;
      }
      
      await jobRef.update(updates);
      
      await createFirestoreAuditLog(payload.operatorName, payload.stage, payload.kpNo, "Cycle Ended", `Completed ${payload.stage} process, routed to ${nextStage}`);
      
      await db.collection("notifications").add({
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        message: `Job ${payload.kpNo} completed stage ${payload.stage} and moved to ${nextStage}`,
        type: "info",
        read: false
      });
      
      return { success: true };
    }

    // 4.5. APPROVE JOB (From Inspection stage)
    if (reqType === "APPROVE_JOB" || reqType === "APPROVEJOB") {
      if (!jobRef) throw new Error(`Job ${payload.kpNo} not found`);

      const nextStage = payload.nextStage || "Masking";
      const nextStageKey = nextStage.toLowerCase().replace(/[^a-z]/g, "");

      const inspectionData = jobData.inspection || { status: "Pending" };
      inspectionData.status = "Completed";
      inspectionData.endTime = new Date().toISOString();
      inspectionData.startTime = inspectionData.startTime || jobData.createdDate?.toDate?.()?.toISOString() || new Date().toISOString();
      inspectionData.operatorName = payload.operatorName || "";

      const updates = {
        currentStage: nextStage,
        currentStatus: "Pending",
        assignedOperator: null,
        shift: "",
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        inspection: inspectionData,
        [`stageAssignedAt.${nextStageKey}`]: new Date().toISOString()
      };

      if (nextStage !== "Dispatched") {
        const nextStageData = jobData[nextStageKey] || { status: "Pending" };
        nextStageData.status = "Pending";
        nextStageData.queueEntryTime = new Date().toISOString();
        updates[nextStageKey] = nextStageData;
      }

      await jobRef.update(updates);

      await createFirestoreAuditLog(payload.operatorName, "Inspection", payload.kpNo, "Cycle Ended", `Approved & Pushed job from Inspection to ${nextStage}`);
      return { success: true };
    }
    
    // 5. ADD MATERIAL CONSUMPTION
    if (reqType === "ADD_MATERIAL_CONSUMPTION" || reqType === "ADDMATERIALCONSUMPTION") {
      if (!jobRef) throw new Error(`Job ${payload.kpNo} not found`);
      
      const mcDoc = db.collection("jobs").doc(jobRef.id).collection("material_consumption").doc();
      await mcDoc.set({
        consumptionId: mcDoc.id,
        stage: payload.stage,
        materialName: payload.materialName,
        category: payload.materialType || "",
        batchNumber: payload.batch || "",
        plannedQty: Number(payload.plannedQty || 0),
        actualQty: Number(payload.actualQty || 0),
        unit: payload.unit || "",
        operator: { uid: currentUser?.uid || "", name: payload.operatorName },
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      const masking = jobData.masking || { materials: [] };
      masking.materials = masking.materials || [];
      const matIdx = masking.materials.findIndex(m => m.name === payload.materialName);
      const newMat = {
        name: payload.materialName,
        type: payload.materialType || "",
        batch: payload.batch || "",
        unit: payload.unit || "",
        plannedQty: Number(payload.plannedQty || 0),
        actualQty: Number(payload.actualQty || 0)
      };
      if (matIdx !== -1) {
        masking.materials[matIdx] = newMat;
      } else {
        masking.materials.push(newMat);
      }
      
      await jobRef.update({
        masking: masking,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      await createFirestoreAuditLog(payload.operatorName, payload.stage, payload.kpNo, "Material Synced", `Logged material consumption ${payload.materialName} (Actual: ${payload.actualQty})`);
      return { success: true };
    }
    
    // 6. DELETE MATERIAL CONSUMPTION
    if (reqType === "DELETE_MATERIAL_CONSUMPTION" || reqType === "DELETEMATERIALCONSUMPTION") {
      if (!jobRef) throw new Error(`Job ${payload.kpNo} not found`);
      
      const mcSnap = await db.collection("jobs").doc(jobRef.id).collection("material_consumption")
        .where("materialName", "==", payload.materialName)
        .where("stage", "==", payload.stage).get();
      
      const batch = db.batch();
      mcSnap.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      
      const masking = jobData.masking || { materials: [] };
      masking.materials = masking.materials || [];
      masking.materials = masking.materials.filter(m => m.name !== payload.materialName);
      
      await jobRef.update({
        masking: masking,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      await createFirestoreAuditLog(payload.operatorName, payload.stage, payload.kpNo, "Material Removed", `Removed material ${payload.materialName}`);
      return { success: true };
    }
    
    // 7. CREATE AUDIT LOG
    if (reqType === "CREATE_AUDIT_LOG" || reqType === "CREATEAUDITLOG") {
      await createFirestoreAuditLog(payload.user, payload.department, payload.kpNo, "Event", payload.action);
      return { success: true };
    }
    
    // 8. CREATE JOB
    if (reqType === "CREATE_JOB" || reqType === "CREATEJOB") {
      const jobId = `job_${payload.kpNo || Math.floor(100000 + Math.random() * 900000)}`;
      await db.collection("jobs").doc(jobId).set({
        jobId: jobId,
        kpNumber: payload.kpNo,
        partName: payload.partName,
        customer: payload.customer,
        quantity: Number(payload.quantity || 1),
        processType: payload.processType || "Plasma",
        priority: payload.priority || "Normal",
        currentStage: payload.currentDepartment || "Inspection",
        currentStatus: payload.status || "Inspection Pending",
        storeLocation: payload.storeLocation || "",
        jcNo: payload.jcNo || "",
        createdDate: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: currentUser?.email || "System",
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        inspectionDate: payload.inspectionDate || new Date().toISOString().split('T')[0],
        plannedCompletionDate: payload.plannedCompletionDate || "",
        inspection: { status: "Pending", queueEntryTime: new Date().toISOString() },
        masking: { status: "Pending", materials: [], holdHistory: [] },
        spraying: { status: "Pending" },
        grinding: { status: "Pending", holdHistory: [] },
        polishing: { status: "Pending" },
        finalInspection: { status: "Pending" },
        dispatch: { status: "Pending" }
      });
      
      await createFirestoreAuditLog(currentUser?.email || "System", "Inspection", payload.kpNo, "Job Registered", `Registered new component ${payload.partName}`);
      return { success: true };
    }

    // 9. UPDATE JOB LOCATION
    if (reqType === "UPDATE_JOB_LOCATION") {
      if (!jobRef) throw new Error(`Job ${payload.kpNo} not found`);
      await jobRef.update({
        storeLocation: payload.location,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      });
      await createFirestoreAuditLog(currentUser?.email || "System", "Spraying", payload.kpNo, "Location Updated", `Updated store location to ${payload.location}`);
      return { success: true };
    }

    // 10. UPDATE JOB STAGE
    if (reqType === "UPDATE_JOB_STAGE") {
      if (!jobRef) throw new Error(`Job ${payload.kpNo} not found`);
      
      const newStage = payload.currentDepartment;
      const updates = {
        currentStage: newStage,
        currentStatus: payload.status || "Pending",
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      };
      
      if (newStage === "Masking") {
        updates.masking = jobData.masking || { status: "Pending", materials: [], holdHistory: [] };
        updates.masking.status = "Pending";
      }
      
      await jobRef.update(updates);
      await createFirestoreAuditLog("System", newStage, payload.kpNo, "Stage Updated", `Sync updated stage to ${newStage}`);
      return { success: true };
    }

    // 11. BYPASS MASKING
    if (reqType === "BYPASS_MASKING") {
      if (!jobRef) throw new Error(`Job ${payload.kpNo} not found`);
      
      const nextStageKeyName = nextStage.toLowerCase().replace(/[^a-z]/g, "");
      const updates = {
        currentStage: nextStage,
        currentStatus: "Pending",
        assignedOperator: null,
        shift: "",
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        masking: {
          status: "No Masking Required",
          operatorName: payload.operatorName,
          noMaskingReason: payload.reason,
          noMasking: true,
          endTime: new Date().toISOString()
        },
        [`stageAssignedAt.${nextStageKeyName}`]: new Date().toISOString()
      };
      
      updates[nextStageKeyName] = { 
        status: "Pending",
        queueEntryTime: new Date().toISOString()
      };
      
      await jobRef.update(updates);
      await createFirestoreAuditLog(payload.operatorName, "Masking", payload.kpNo, "No Masking Required", `Bypassed masking (Reason: ${payload.reason || "N/A"}), routed to ${nextStage}`);
      return { success: true };
    }

    // 12. SPLIT MASKING
    if (reqType === "SPLIT_MASKING") {
      if (!jobRef) throw new Error(`Job ${payload.kpNo} not found`);
      
      const stageKey = "masking";
      const stageData = jobData[stageKey] || {};
      
      stageData.status = "Completed";
      stageData.endTime = payload.endTime || new Date().toISOString();
      stageData.activeTimeMs = Number(payload.activeTimeMs || 0);
      stageData.holdHistory = payload.holdHistory || [];
      stageData.operatorName = payload.operatorName;
      
      // Update original job
      await jobRef.update({
        quantity: Number(payload.doneQty),
        currentStage: "Masking",
        currentStatus: "Completed",
        assignedOperator: null,
        shift: "",
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        [stageKey]: stageData
      });
      
      // Create new split job
      const splitJobId = `job_${payload.splitKp.replace(/[^a-zA-Z0-9]/g, "_") || Math.floor(100000 + Math.random() * 900000)}`;
      const nextStageKey = (payload.nextStage || "Masking").toLowerCase().replace(/[^a-z]/g, "");
      const originalStageAssignedAt = jobData.stageAssignedAt || {};
      const newStageAssignedAt = {
        ...originalStageAssignedAt,
        [nextStageKey]: new Date().toISOString()
      };

      await db.collection("jobs").doc(splitJobId).set({
        jobId: splitJobId,
        kpNumber: payload.splitKp,
        partName: jobData.partName,
        customer: jobData.customer,
        quantity: Number(payload.restQty),
        processType: jobData.processType || "Plasma",
        priority: jobData.priority || "Normal",
        currentStage: payload.nextStage,
        currentStatus: "Pending",
        storeLocation: jobData.storeLocation || "",
        createdDate: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: currentUser?.email || "System",
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        masking: { status: "Pending", materials: [], holdHistory: [] },
        spraying: { status: "Pending" },
        grinding: { status: "Pending", holdHistory: [] },
        polishing: { status: "Pending" },
        finalInspection: { status: "Pending" },
        dispatch: { status: "Pending" },
        stageAssignedAt: newStageAssignedAt
      });
      
      await createFirestoreAuditLog(payload.operatorName, "Masking", payload.kpNo, "Job Split Completed", `Masked ${payload.doneQty} pcs, split remaining ${payload.restQty} pcs to ${payload.nextStage} as ${payload.splitKp}`);
      return { success: true };
    }

    // 13. SPLIT STAGE
    if (reqType === "SPLIT_STAGE") {
      if (!jobRef) throw new Error(`Job ${payload.kpNo} not found`);
      
      const stageName = payload.stage;
      const stageKey = stageName.toLowerCase().replace(/[^a-z]/g, "");
      
      // Update original job (keeps the remaining quantity in the current stage as Pending)
      const origStageData = {
        status: "Pending",
        holdHistory: []
      };
      if (stageKey === "masking") {
        origStageData.materials = [];
      } else if (stageKey === "grinding") {
        origStageData.processType = "";
        origStageData.machineName = "";
        origStageData.storeLocation = "";
        origStageData.quantity = Number(payload.restQty);
        origStageData.durationMs = 0;
        origStageData.activeTimeMs = 0;
      }

      await jobRef.update({
        quantity: Number(payload.restQty),
        currentStage: stageName,
        currentStatus: "Pending",
        assignedOperator: null,
        shift: "",
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        splitRemark: `${payload.doneQty}/${Number(payload.doneQty) + Number(payload.restQty)} done → ${payload.nextStage}. Remaining: ${payload.restQty} pending.`,
        [stageKey]: origStageData
      });
      
      // Create new split job doc for completed parts progressing to the next stage
      const splitStageData = {
        status: "Completed",
        endTime: payload.endTime || new Date().toISOString(),
        operatorName: payload.operatorName
      };
      if (payload.stageData) {
        Object.assign(splitStageData, payload.stageData);
      }

      const splitJobId = `job_${payload.splitKp.replace(/[^a-zA-Z0-9]/g, "_") || Math.floor(100000 + Math.random() * 900000)}`;
      
      const nextStageKey = (payload.nextStage || "Masking").toLowerCase().replace(/[^a-z]/g, "");
      const originalStageAssignedAt = jobData.stageAssignedAt || {};
      const newStageAssignedAt = {
        ...originalStageAssignedAt,
        [nextStageKey]: new Date().toISOString()
      };

      const splitJobDoc = {
        jobId: splitJobId,
        kpNumber: payload.splitKp,
        partName: jobData.partName,
        customer: jobData.customer,
        quantity: Number(payload.doneQty),
        processType: jobData.processType || "Plasma",
        priority: jobData.priority || "Normal",
        currentStage: payload.nextStage,
        currentStatus: "Pending",
        storeLocation: jobData.storeLocation || "",
        createdDate: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: currentUser?.email || "System",
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        qtyHistory: payload.qtyHistory || [],
        splitRemark: "",
        masking: { status: "Pending", materials: [], holdHistory: [] },
        spraying: { status: "Pending" },
        grinding: { status: "Pending", holdHistory: [] },
        polishing: { status: "Pending" },
        finalInspection: { status: "Pending" },
        dispatch: { status: "Pending" },
        stageAssignedAt: newStageAssignedAt
      };

      splitJobDoc[stageKey] = splitStageData;

      // Copy other completed stages
      const stagesList = ["masking", "spraying", "grinding", "polishing", "finalInspection", "dispatch"];
      stagesList.forEach(st => {
        if (st !== stageKey && jobData[st] && jobData[st].status === "Completed") {
          splitJobDoc[st] = jobData[st];
        }
      });

      await db.collection("jobs").doc(splitJobId).set(splitJobDoc);
      
      await createFirestoreAuditLog(payload.operatorName, stageName, payload.kpNo, "Job Split Completed", `${stageName} completed ${payload.doneQty} pcs (split to ${payload.nextStage} as ${payload.splitKp}), remaining ${payload.restQty} pcs stay in ${stageName}`);
      return { success: true };
    }
    
    throw new Error(`Unhandled transaction type: ${reqType}`);
  } catch (err) {
    console.warn("Firestore post sync error:", err.message || err);
    handleFirestoreError("backend-post-write", err);
    logErrorToFirestore("sendBackendPost", err);
    throw err;
  }
}

function setupMaskingSubtabs() {
  const subtabButtons = document.querySelectorAll(".masking-tab-btn");
  const subtabPanels = document.querySelectorAll(".masking-subtab-panel");

  subtabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetSubtab = btn.getAttribute("data-subtab");
      if (!targetSubtab) return;

      activeMaskingSubtab = targetSubtab;
      
      subtabButtons.forEach(b => b.classList.remove("active"));
      subtabPanels.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const targetPanel = document.getElementById(targetSubtab);
      if (targetPanel) targetPanel.classList.add("active");

      // Re-render Masking View
      renderMaskingDashboard();
    });
  });
}

function setupHamburger() {
  const hamburgerBtn = document.getElementById("btn-hamburger");
  const appContainer = document.getElementById("app-container");
  const backdrop = document.getElementById("sidebar-backdrop");

  if (hamburgerBtn) {
    hamburgerBtn.addEventListener("click", () => {
      if (window.innerWidth <= 1280) {
        appContainer.classList.toggle("sidebar-open");
      } else {
        appContainer.classList.toggle("sidebar-collapsed");
      }
    });
  }

  if (backdrop) {
    backdrop.addEventListener("click", () => {
      appContainer.classList.remove("sidebar-open");
    });
  }
}

function switchToSubtab(subtabId) {
  activeMaskingSubtab = subtabId;
  const subtabButtons = document.querySelectorAll(".masking-tab-btn");
  const subtabPanels = document.querySelectorAll(".masking-subtab-panel");

  subtabButtons.forEach(btn => {
    if (btn.getAttribute("data-subtab") === subtabId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  subtabPanels.forEach(panel => {
    if (panel.id === subtabId) {
      panel.classList.add("active");
    } else {
      panel.classList.remove("active");
    }
  });
}

function populateHeaderUser() {
  const display = document.getElementById("sidebar-user-display");
  const roleDisplay = document.getElementById("sidebar-user-role-display");
  const avatarChar = document.getElementById("sidebar-avatar-char");
  
  if (currentUser) {
    const cleanName = currentUser.name || currentUser.email.split('@')[0];
    if (display) display.textContent = cleanName;
    if (roleDisplay) roleDisplay.textContent = currentUser.role.replace('_', ' ').toUpperCase();
    if (avatarChar) avatarChar.textContent = cleanName.charAt(0).toUpperCase();
  }
}

// Get currently logged user in header
function getLoggedUser() {
  return {
    name: currentUser ? currentUser.email : "System Operator",
    shift: (shiftSelect && shiftSelect.value) || "A Shift",
    role: currentUser ? currentUser.role : "System",
    department: currentUser ? currentUser.department : "System"
  };
}

function applySidebarPermissions() {
  const navBtns = document.querySelectorAll(".nav-btn");
  navBtns.forEach(btn => {
    const tabId = btn.getAttribute("data-tab");
    if (tabId && isTabAuthorized(tabId)) {
      btn.style.display = "flex";
    } else {
      btn.style.display = "none";
    }
  });
  
  const sepStages = document.getElementById("nav-sep-stages");
  const sepAdmin = document.getElementById("nav-sep-admin");
  if (currentUser && currentUser.role === 'operator') {
    if (sepStages) sepStages.style.display = "none";
    if (sepAdmin) sepAdmin.style.display = "none";
  } else {
    if (sepStages) sepStages.style.display = "block";
    if (sepAdmin) sepAdmin.style.display = "block";
  }
  
  const btnReset = document.getElementById("btn-reset-data");
  if (btnReset) {
    if (currentUser && currentUser.role === 'super_admin') {
      btnReset.style.display = "block";
    } else {
      btnReset.style.display = "none";
    }
  }


}

function handleRouting(isInitialLoad = false) {
  const activePane = document.querySelector(".tab-pane.active");
  const defaultTab = getDefaultTab();
  const hash = window.location.hash || `#/${defaultTab.replace('tab-', '')}`;
  const cleanHash = hash.replace('#/', '');
  const targetTabId = `tab-${cleanHash}`;

  if (activePane && activePane.id === "tab-spraying" && targetTabId !== "tab-spraying" && window.sprayingJobActive) {
    alert("Cannot switch screens while a Spraying job is in progress!");
    // Revert the hash change
    window.removeEventListener("hashchange", handleRouting);
    window.location.hash = "#/spraying";
    setTimeout(() => {
      window.addEventListener("hashchange", handleRouting);
    }, 50);
    return;
  }
  
  const pane = document.getElementById(targetTabId);
  if (!pane) {
    window.location.hash = `#/${defaultTab.replace('tab-', '')}`;
    return;
  }
  
  if (!isTabAuthorized(targetTabId)) {
    if (!isInitialLoad) {
      showAccessDeniedModal(cleanHash.toUpperCase());
    }
    window.location.hash = `#/${defaultTab.replace('tab-', '')}`;
    return;
  }
  
  switchToTab(targetTabId);
}

function switchToTab(tabId) {
  const navButtons = document.querySelectorAll(".nav-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");
  
  navButtons.forEach(btn => {
    if (btn.getAttribute("data-tab") === tabId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
  
  tabPanes.forEach(pane => {
    if (pane.id === tabId) {
      pane.classList.add("active");
    } else {
      pane.classList.remove("active");
    }
  });
  
  const appContainer = document.getElementById("app-container");
  if (appContainer) {
    appContainer.classList.remove("sidebar-open");
  }
  
  renderAll();
}

function showAccessDeniedModal(stageName) {
  const modal = document.getElementById("access-denied-modal");
  const reasonEl = document.getElementById("access-denied-reason");
  const detailsEl = document.getElementById("access-denied-user-details");
  if (modal && reasonEl) {
    reasonEl.textContent = `Access Denied to: ${stageName}`;
    if (detailsEl) {
      detailsEl.innerHTML = `
        <strong style="color: var(--status-hold);">Logged In User Diagnostics:</strong><br>
        <strong>Email:</strong> ${currentUser ? currentUser.email : "No active session user"}<br>
        <strong>Role:</strong> ${currentUser ? currentUser.role : "N/A"}<br>
        <strong>Department:</strong> ${currentUser ? currentUser.department : "N/A"}
      `;
    }
    modal.classList.add("active");
  }
  createAuditLog(currentUser ? currentUser.email : "System", null, `Security Alert: Unauthorized access attempt to ${stageName}`);
}

function applyControlRestrictions() {
  if (!currentUser) return;
  const isReadOnly = (currentUser.role === 'hr_admin' || currentUser.role === 'quality_admin');
  
  const timerActionsList = document.querySelectorAll(".timer-actions-bar");
  timerActionsList.forEach(bar => {
    bar.style.display = isReadOnly ? "none" : "flex";
  });
  
  const btnAddMat = document.getElementById("btn-add-mat-to-job");
  if (btnAddMat) {
    if (isReadOnly) {
      btnAddMat.style.display = "none";
    } else {
      btnAddMat.style.display = "inline-flex";
    }
  }
  
  const holdTriggerForm = document.getElementById("hold-trigger-form");
  if (holdTriggerForm) {
    if (isReadOnly) {
      holdTriggerForm.style.display = "none";
    } else {
      holdTriggerForm.style.display = "block";
    }
  }
  
  const inspectionForm = document.getElementById("inspection-job-form");
  if (inspectionForm && currentUser.role === 'hr_admin') {
    const formPanel = inspectionForm.closest(".panel");
    if (formPanel) formPanel.style.display = "none";
  } else if (inspectionForm) {
    const formPanel = inspectionForm.closest(".panel");
    if (formPanel) formPanel.style.display = "block";
  }

  // Grinding control restrictions
  const grindingTimerActions = document.getElementById("grinding-active-job-timer-interface");
  if (grindingTimerActions) {
    const opRemarks = document.getElementById("grinding-operator-remarks");
    const qualRemarks = document.getElementById("grinding-quality-remarks");
    const grindNotes = document.getElementById("grinding-notes");
    if (opRemarks) opRemarks.disabled = isReadOnly;
    if (qualRemarks) qualRemarks.disabled = isReadOnly;
    if (grindNotes) grindNotes.disabled = isReadOnly;
  }

  // Show or hide subtabs in the Masking stage dashboard based on user roles
  const supervisorBtn = document.querySelector('[data-subtab="masking-subtab-supervisor"]');
  if (supervisorBtn) {
    if (currentUser.role === 'super_admin' || currentUser.role === 'production_admin') {
      supervisorBtn.style.display = "flex";
    } else {
      supervisorBtn.style.display = "none";
      if (activeMaskingSubtab === "masking-subtab-supervisor") {
        switchToSubtab("masking-subtab-queue");
      }
    }
  }

  const materialsBtn = document.querySelector('[data-subtab="masking-subtab-materials"]');
  if (materialsBtn) {
    if (currentUser.role === 'super_admin' || currentUser.role === 'production_admin' || currentUser.role === 'hr_admin') {
      materialsBtn.style.display = "flex";
    } else {
      materialsBtn.style.display = "none";
      if (activeMaskingSubtab === "masking-subtab-materials") {
        switchToSubtab("masking-subtab-queue");
      }
    }
  }
}

// 4. AUDIT LOGGER
async function createAuditLog(user, kpNumber, action) {
  let userRole = "System";
  let userDept = "System";
  
  if (currentUser && currentUser.email === user) {
    userRole = currentUser.role;
    userDept = currentUser.department;
  }
  
  const department = kpNumber ? (jobs.find(j => j.kpNumber === kpNumber)?.currentDepartment || "Masking") : userDept;
  
  const log = {
    timestamp: new Date().toISOString(),
    user: user,
    role: userRole,
    department: department,
    kpNumber: kpNumber || "N/A",
    action: action
  };
  
  auditLogs.unshift(log);
  renderAuditLogs();

  if (!isMockMode()) {
    await createFirestoreAuditLog(user, department, kpNumber, "Event", action);
  } else {
    const payload = {
      type: "CREATE_AUDIT_LOG",
      user: user,
      department: department,
      kpNo: kpNumber || "N/A",
      action: action,
      details: `${userRole.toUpperCase()} action on component: ${action}`
    };
    
    try {
      fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.error("Failed to post audit log:", err);
    }
  }
}

function triggerFinalInspectionFloatingTransition(kpNumber) {
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (!job) return;

  const doneQtyStr = prompt(`Enter quantity completed for Final QA (out of ${job.quantity}):`, job.quantity);
  if (doneQtyStr === null) return; // Cancelled
  const doneQty = parseInt(doneQtyStr);
  if (isNaN(doneQty) || doneQty <= 0 || doneQty > job.quantity) {
    alert(`Please enter a valid quantity done (must be between 1 and ${job.quantity}).`);
    return;
  }

  const payloadGenerator = (nextStage) => {
    const isSplit = doneQty < job.quantity;
    if (isSplit) {
      return splitJobAndProgress(job, doneQty, nextStage, getLoggedUser().name, "Final Inspection");
    } else {
      return {
        type: "END_CYCLE",
        kpNo: job.kpNumber,
        stage: "Final Inspection",
        operatorName: getLoggedUser().name,
        endTime: new Date().toISOString(),
        activeTimeMs: 0,
        nextStage: nextStage
      };
    }
  };

  const applyLocalMutation = (nextStage) => {
    const isSplit = doneQty < job.quantity;
    if (!isSplit) {
      transitionToStage(job, nextStage, getLoggedUser().name);
    }
  };

  showFloatingCardTransition(job, "Final Inspection", payloadGenerator, applyLocalMutation);
}

function renderFinalInspectionDashboard() {
  const container = document.getElementById("final-inspection-queue-cards");
  if (!container) return;
  container.innerHTML = "";
  
  const filterKp = document.getElementById("final-filter-kp") ? document.getElementById("final-filter-kp").value.toLowerCase() : "";
  const filterJc = document.getElementById("final-filter-jc") ? document.getElementById("final-filter-jc").value.toLowerCase() : "";
  const filterCust = document.getElementById("final-filter-customer") ? document.getElementById("final-filter-customer").value.toLowerCase() : "";
  const filterProc = document.getElementById("final-filter-process") ? document.getElementById("final-filter-process").value : "";
  const filterStat = document.getElementById("final-filter-status") ? document.getElementById("final-filter-status").value : "";

  const finalJobs = jobs.filter(j => {
    if (j.currentDepartment !== "Final Inspection") return false;
    
    if (filterKp && !j.kpNumber.toLowerCase().includes(filterKp)) return false;
    if (filterJc && !getJobJcNo(j).toLowerCase().includes(filterJc)) return false;
    if (filterCust && !j.customer.toLowerCase().includes(filterCust)) return false;
    if (filterProc && j.processType !== filterProc) return false;
    if (filterStat && (j.finalInspection?.status || "Pending") !== filterStat) return false;
    
    return true;
  });

  if (finalJobs.length === 0) {
    container.innerHTML = `<div class="no-selection-message" style="grid-column: 1 / -1; width: 100%;">No components in final inspection queue matching the filters.</div>`;
    return;
  }
  
  const isReadOnly = (currentUser && currentUser.role === 'hr_admin');
  
  finalJobs.forEach(job => {
    const cleanJc = getJobJcNo(job);
    const priorityClass = String(job.priority || "Normal").toLowerCase();
    const card = document.createElement("div");
    card.className = "stage-kanban-card";
    card.draggable = !isReadOnly;
    
    let statusClass = "badge-pending";
    let statusText = "QA Review Pending";
    const fStatus = job.finalInspection?.status || "Pending";
    if (fStatus === "In Progress") {
      statusClass = "badge-progress";
      statusText = "QA Review In Progress";
    } else if (fStatus === "Hold") {
      statusClass = "badge-hold";
      statusText = "QA Review On Hold";
    }

    if (!isReadOnly) {
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", job.kpNumber);
        card.classList.add("dragging");
        triggerFinalInspectionFloatingTransition(job.kpNumber);
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
      });
    }

    card.innerHTML = `
      <div class="stage-card-priority-strip ${priorityClass}"></div>
      <div class="job-card-header" style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
        <span class="font-mono font-bold text-cyan" style="font-size: 14px;">${getCleanKpNumber(job.kpNumber)}${cleanJc ? ` (${cleanJc})` : ""}</span>
        <span class="badge badge-normal" style="font-size: 10px; font-weight: 700;">${job.processType}</span>
      </div>
      <div class="job-card-body" style="font-size: 12px; display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px;">
        <div class="job-card-row">
          <span class="job-card-label">Part Name:</span>
          <span class="job-card-value">${job.partName}</span>
        </div>
        <div class="job-card-row">
          <span class="job-card-label">Customer:</span>
          <span class="job-card-value">${job.customer}</span>
        </div>
        <div class="job-card-row">
          <span class="job-card-label">Quantity:</span>
          <span class="job-card-value font-mono">${renderQuantityWithHistory(job, true)}</span>
        </div>
        <div class="job-card-row">
          <span class="job-card-label">Status:</span>
          <span class="job-card-value"><span class="badge ${statusClass}">${statusText}</span></span>
        </div>
      </div>
      <div class="stage-card-actions" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px; display: flex; flex-direction: column; gap: 8px;">
        <button class="btn btn-success btn-xs" style="width:100%; height:32px; ${isReadOnly ? 'display:none;' : ''}" onclick="triggerFinalInspectionFloatingTransition('${job.kpNumber}')">Approve QA & Close</button>
        ${buildDeleteJobButtonHTML(job.kpNumber)}
      </div>
    `;
    container.appendChild(card);
  });
}

function triggerDispatchFloatingTransition(kpNumber) {
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (!job) return;

  const doneQtyStr = prompt(`Enter quantity completed for Dispatch (out of ${job.quantity}):`, job.quantity);
  if (doneQtyStr === null) return; // Cancelled
  const doneQty = parseInt(doneQtyStr);
  if (isNaN(doneQty) || doneQty <= 0 || doneQty > job.quantity) {
    alert(`Please enter a valid quantity done (must be between 1 and ${job.quantity}).`);
    return;
  }

  const payloadGenerator = (nextStage) => {
    const isSplit = doneQty < job.quantity;
    if (isSplit) {
      return splitJobAndProgress(job, doneQty, nextStage, getLoggedUser().name, "Dispatch");
    } else {
      return {
        type: "END_CYCLE",
        kpNo: job.kpNumber,
        stage: "Dispatch",
        operatorName: getLoggedUser().name,
        endTime: new Date().toISOString(),
        activeTimeMs: 0,
        nextStage: nextStage
      };
    }
  };

  const applyLocalMutation = (nextStage) => {
    const isSplit = doneQty < job.quantity;
    if (!isSplit) {
      transitionToStage(job, nextStage, getLoggedUser().name);
      if (nextStage === "Dispatched") {
        job.status = "Completed";
      }
    }
  };

  showFloatingCardTransition(job, "Dispatch", payloadGenerator, applyLocalMutation);
}

function renderDispatchDashboard() {
  const container = document.getElementById("dispatch-queue-cards");
  if (!container) return;
  container.innerHTML = "";
  
  const dispatchJobs = jobs.filter(j => j.currentDepartment === "Dispatch");
  if (dispatchJobs.length === 0) {
    container.innerHTML = `<div class="no-selection-message" style="grid-column: 1 / -1; width: 100%;">No components ready for dispatch.</div>`;
    return;
  }
  
  const isReadOnly = (currentUser && (currentUser.role === 'hr_admin' || currentUser.role === 'quality_admin'));
  
  dispatchJobs.forEach(job => {
    const cleanJc = getJobJcNo(job);
    const priorityClass = String(job.priority || "Normal").toLowerCase();
    const card = document.createElement("div");
    card.className = "stage-kanban-card";
    card.draggable = !isReadOnly;
    
    if (!isReadOnly) {
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", job.kpNumber);
        card.classList.add("dragging");
        triggerDispatchFloatingTransition(job.kpNumber);
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
      });
    }

    card.innerHTML = `
      <div class="stage-card-priority-strip ${priorityClass}"></div>
      <div class="job-card-header" style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
        <span class="font-mono font-bold text-cyan" style="font-size: 14px;">${getCleanKpNumber(job.kpNumber)}${cleanJc ? ` (${cleanJc})` : ""}</span>
        <span class="badge badge-normal" style="font-size: 10px; font-weight: 700;">${job.processType}</span>
      </div>
      <div class="job-card-body" style="font-size: 12px; display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px;">
        <div class="job-card-row">
          <span class="job-card-label">Part Name:</span>
          <span class="job-card-value">${job.partName}</span>
        </div>
        <div class="job-card-row">
          <span class="job-card-label">Customer:</span>
          <span class="job-card-value">${job.customer}</span>
        </div>
        <div class="job-card-row">
          <span class="job-card-label">Quantity:</span>
          <span class="job-card-value font-mono">${renderQuantityWithHistory(job, true)}</span>
        </div>
        <div class="job-card-row">
          <span class="job-card-label">Status:</span>
          <span class="job-card-value"><span class="badge badge-completed">Ready for Dispatch</span></span>
        </div>
      </div>
      <div class="stage-card-actions" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px; display: flex; flex-direction: column; gap: 8px;">
        <button class="btn btn-success btn-xs" style="width:100%; height:32px; ${isReadOnly ? 'display:none;' : ''}" onclick="triggerDispatchFloatingTransition('${job.kpNumber}')">Dispatch & Close</button>
        ${buildDeleteJobButtonHTML(job.kpNumber)}
      </div>
    `;
    container.appendChild(card);
  });
}

function renderUserManagement() {
  const tbody = document.getElementById("user-management-table-body");
  if (!tbody) return;
  
  const isMock = isMockMode();
  let list = [];
  
  if (!isMock && typeof users !== 'undefined' && Array.isArray(users) && users.length > 0) {
    list = users;
  } else {
    list = MOCK_DB.getUsers();
  }

  renderUserRows(list);
}

function renderUserRows(users) {
  const tbody = document.getElementById("user-management-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  
  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No registered users in system.</td></tr>`;
    return;
  }
  
  users.forEach(user => {
    const tr = document.createElement("tr");
    
    // Status text & badge
    let statusText = "Pending Approval";
    let badgeClass = "badge-pending";
    if (user.active) {
      statusText = "Active";
      badgeClass = "badge-completed";
    } else if (user.role && user.role !== "pending" && user.role !== "Pending") {
      statusText = "Suspended";
      badgeClass = "badge-hold";
    }
    
    const isSelf = currentUser && currentUser.email.toLowerCase() === user.email.toLowerCase();
    const isVerified = user.emailVerified ? "Yes" : "No";
    const verifiedBadge = user.emailVerified ? "badge-completed" : "badge-pending";
    const name = user.name || "Pending Name";
    
    // Dropdown selects for Role
    const roles = [
      { val: "pending", label: "Pending" },
      { val: "operator", label: "Operator" },
      { val: "production_admin", label: "Production Admin" },
      { val: "hr_admin", label: "HR Admin" },
      { val: "quality_admin", label: "Quality Admin" },
      { val: "it_team", label: "IT Team" },
      { val: "super_admin", label: "Super Admin" }
    ];
    let roleSelectHtml = `<select id="user-role-select-${user.uid}" class="form-input select-sm" ${isSelf ? 'disabled' : ''} style="height:32px; padding:2px 5px; font-size:12px; min-width:130px;">`;
    roles.forEach(r => {
      roleSelectHtml += `<option value="${r.val}" ${user.role === r.val ? 'selected' : ''}>${r.label}</option>`;
    });
    roleSelectHtml += `</select>`;

    // Dropdown selects for Department
    const depts = [
      { val: "pending", label: "Pending" },
      { val: "Masking", label: "Masking" },
      { val: "Spraying", label: "Spraying" },
      { val: "Grinding", label: "Grinding" },
      { val: "Polishing", label: "Polishing" },
      { val: "Inspection", label: "Inspection" },
      { val: "All", label: "All Departments" }
    ];
    let deptSelectHtml = `<select id="user-dept-select-${user.uid}" class="form-input select-sm" ${isSelf ? 'disabled' : ''} style="height:32px; padding:2px 5px; font-size:12px; min-width:120px;">`;
    depts.forEach(d => {
      deptSelectHtml += `<option value="${d.val}" ${user.department === d.val ? 'selected' : ''}>${d.label}</option>`;
    });
    deptSelectHtml += `</select>`;

    tr.innerHTML = `
      <td>
        <div style="font-weight:bold;">${name}</div>
        <div class="text-xs text-muted" style="font-size:11px; margin-top:2px;">${user.email}</div>
      </td>
      <td><span class="badge ${verifiedBadge}">${isVerified}</span></td>
      <td style="font-family: monospace; font-weight: bold; letter-spacing: 1px;">${user.pin || "N/A"}</td>
      <td>${roleSelectHtml}</td>
      <td>${deptSelectHtml}</td>
      <td><span class="badge ${badgeClass}">${statusText}</span></td>
      <td>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-success btn-xs" onclick="saveAndApproveUser('${user.uid}')" ${isSelf ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
            Save & Approve
          </button>
          <button class="btn btn-warning btn-xs" onclick="toggleUserStatus('${user.uid}')" ${isSelf ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
            ${user.active ? 'Disable' : 'Enable'}
          </button>
          <button class="btn btn-danger btn-xs" onclick="deleteUser('${user.uid}')" ${isSelf ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
            Delete
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function saveAndApproveUser(uid) {
  const roleSelect = document.getElementById(`user-role-select-${uid}`);
  const deptSelect = document.getElementById(`user-dept-select-${uid}`);
  if (!roleSelect || !deptSelect) return;

  const role = roleSelect.value;
  const department = deptSelect.value;

  const isMock = !firebaseConfig.apiKey || firebaseConfig.apiKey.includes("YOUR_FIREBASE_") || localStorage.getItem("psp_auth_mock") === "true";
  let users = [];
  
  if (!isMock) {
    try {
      const db = firebase.firestore();
      const snapshot = await db.collection("users").get();
      snapshot.forEach(doc => users.push(doc.data()));
    } catch (e) {
      users = MOCK_DB.getUsers();
    }
  } else {
    users = MOCK_DB.getUsers();
  }

  const user = users.find(u => u.uid === uid);
  if (!user) {
    alert("User not found.");
    return;
  }

  // Check super admin singleton constraint
  if (role === 'super_admin') {
    const hasSuper = users.some(u => u.role === 'super_admin' && u.uid !== uid);
    if (hasSuper) {
      alert("Super Admin account already exists.");
      return;
    }
  }

  // Update locally in MOCK_DB
  const mockUsers = MOCK_DB.getUsers();
  const mockUser = mockUsers.find(u => u.uid === uid);
  if (mockUser) {
    mockUser.role = role;
    mockUser.department = department;
    mockUser.active = true;
    mockUser.emailVerified = true; // Auto-verify email upon manual approval by admin
    MOCK_DB.saveUsers(mockUsers);
  }

  if (!isMock) {
    try {
      const db = firebase.firestore();
      await db.collection("users").doc(uid).update({
        role: role,
        department: department,
        active: true,
        emailVerified: true
      });
      alert(`User profile for ${user.email} approved and updated successfully in Firestore.`);
    } catch (err) {
      console.error("Firestore user approval sync error:", err);
      alert("Approved locally, but Firestore sync failed: " + err.message);
    }
  } else {
    alert(`User profile for ${user.email} approved and updated successfully (Mock Mode).`);
  }

  // Audit log
  createAuditLog(currentUser.email, null, `Approved & assigned role ${role.toUpperCase()} and department ${department} to user ${user.email}`);

  renderAll();
}

async function toggleUserStatus(uid) {
  const users = MOCK_DB.getUsers();
  const user = users.find(u => u.uid === uid);
  if (user) {
    user.active = !user.active;
    MOCK_DB.saveUsers(users);
    
    // Audit log
    createAuditLog(currentUser.email, null, `Changed status of user '${user.email}' to ${user.active ? 'Enabled' : 'Disabled'}`);
    
    // If we are in live firebase mode, sync user status
    const isMock = !firebaseConfig.apiKey || firebaseConfig.apiKey.includes("YOUR_FIREBASE_") || localStorage.getItem("psp_auth_mock") === "true";
    if (!isMock) {
      try {
        const db = firebase.firestore();
        await db.collection("users").doc(uid).update({ active: user.active });
      } catch (err) {
        console.error("Firestore user status sync error:", err);
        handleFirestoreError("user-status-write", err);
      }
    }
    
    renderAll();
  }
}

async function deleteUser(uid) {
  const isMock = isMockMode();
  let userList = isMock ? MOCK_DB.getUsers() : users;
  const userIdx = userList.findIndex(u => u.uid === uid);
  if (userIdx !== -1) {
    const user = userList[userIdx];
    if (confirm(`Are you sure you want to delete access profile for: ${user.email}?`)) {
      if (isMock) {
        userList.splice(userIdx, 1);
        MOCK_DB.saveUsers(userList);
        
        // Remove password entry
        const passwords = MOCK_DB.getPasswords();
        delete passwords[user.email];
        localStorage.setItem('mock_db_passwords', JSON.stringify(passwords));
      } else {
        // Optimistically remove from global users and save to cache first
        const globalIdx = users.findIndex(u => u.uid === uid);
        if (globalIdx !== -1) {
          users.splice(globalIdx, 1);
          try {
            localStorage.setItem("psp_cached_users", JSON.stringify(users));
          } catch (e) {}
        }

        // In Firebase mode, delete Firestore doc
        try {
          const db = firebase.firestore();
          await db.collection("users").doc(uid).delete();
        } catch (err) {
          console.error("Firestore user deletion sync error:", err);
          handleFirestoreError("user-delete-write", err);
        }
      }
      
      createAuditLog(currentUser.email, null, `Deleted access profile for user: ${user.email}`);
      renderAll();
    }
  }
}

async function deleteJob(kpNumber) {
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (!job) {
    alert("Job not found.");
    return;
  }

  if (!confirm(`⚠️ Are you sure you want to permanently delete job ${kpNumber}?\n\nStage: ${job.currentDepartment}\nPart: ${job.partName}\nCustomer: ${job.customer}\n\nThis action cannot be undone.`)) {
    return;
  }

  // Remove from local jobs array
  const idx = jobs.findIndex(j => j.kpNumber === kpNumber);
  if (idx !== -1) {
    jobs.splice(idx, 1);
  }

  // Save state and re-render locally immediately to guarantee persistence
  saveState();
  renderAll();

  // Sync to Firestore
  if (!isMockMode() && job.id) {
    try {
      const db = firebase.firestore();
      await db.collection("jobs").doc(job.id).update({
        isDeleted: true,
        status: "Deleted",
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log(`[Delete] Firestore job ${kpNumber} (doc: ${job.id}) marked as deleted.`);
    } catch (err) {
      console.error("Firestore job deletion error:", err);
      handleFirestoreError("job-delete-write", err);
    }
  }

  // Sync to backend (Apps Script)
  try {
    const payload = {
      type: "DELETE_JOB",
      kpNo: kpNumber,
      stage: job.currentDepartment
    };
    await sendBackendPost(payload);
  } catch (err) {
    console.warn("Backend delete sync skipped:", err);
  }

  createAuditLog(currentUser.email, kpNumber, `Deleted job ${kpNumber} from ${job.currentDepartment} stage`);
  
  if (typeof showToast === 'function') {
    showToast("Job Deleted", `Job ${kpNumber} has been permanently removed from the system.`, "danger");
  }
}

function showToast(title, message, type = 'info') {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.position = "fixed";
    container.style.top = "20px";
    container.style.right = "20px";
    container.style.zIndex = "9999";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "10px";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.style.background = "var(--bg-card, #1e293b)";
  toast.style.border = "1px solid var(--border-color, #334155)";
  toast.style.borderRadius = "8px";
  toast.style.padding = "12px 16px";
  toast.style.boxShadow = "0 10px 15px -3px rgba(0, 0, 0, 0.5)";
  toast.style.display = "flex";
  toast.style.alignItems = "center";
  toast.style.gap = "12px";
  toast.style.color = "var(--text-primary, #f8fafc)";
  toast.style.minWidth = "280px";
  toast.style.opacity = "0";
  toast.style.transition = "all 0.3s ease";
  toast.style.transform = "translateX(50px)";

  let color = "#38bdf8"; 
  if (type === 'success') color = "#10b981";
  else if (type === 'danger' || type === 'error') color = "#ef4444";
  else if (type === 'warning') color = "#f59e0b";

  toast.style.borderLeft = `4px solid ${color}`;

  toast.innerHTML = `
    <div style="flex:1;">
      <div style="font-weight:700; font-size:13px; color:${color};">${title}</div>
      <div style="font-size:12px; color:var(--text-muted, #94a3b8); margin-top:2px;">${message}</div>
    </div>
    <button type="button" style="background:none; border:none; color:var(--text-muted); font-size:16px; cursor:pointer;" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(0)";
  }, 10);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(50px)";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
window.showToast = showToast;

// Expose stage functions to global window scope so onclick bindings can reach them
window.triggerPolishingFloatingTransition = triggerPolishingFloatingTransition;
window.triggerFinalInspectionFloatingTransition = triggerFinalInspectionFloatingTransition;
window.triggerDispatchFloatingTransition = triggerDispatchFloatingTransition;
window.toggleUserStatus = toggleUserStatus;
window.deleteUser = deleteUser;
window.deleteJob = deleteJob;
window.saveAndApproveUser = saveAndApproveUser;

// 13. DOM EVENTS HOOKS & ATTACHMENTS
function setupEventListeners() {
  // Modal Close triggers
  const modal = document.getElementById("modal-assign-operator");
  modal.querySelector(".modal-close").addEventListener("click", closeAssignModal);
  modal.querySelector(".modal-cancel-btn").addEventListener("click", closeAssignModal);

  // Operator modal submit form
  document.getElementById("operator-assign-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const kp = document.getElementById("modal-kp-display").textContent;
    if (!selectedOperatorName) {
      alert("Please select an operator first.");
      return;
    }
    startMaskingCycle(kp, selectedOperatorName, selectedShiftName);
  });

  // No Masking Required triggers
  const noMaskingModal = document.getElementById("modal-no-masking-required");
  if (noMaskingModal) {
    const closeBtn = document.getElementById("btn-close-no-masking");
    if (closeBtn) closeBtn.addEventListener("click", closeNoMaskingModal);
    const cancelBtn = document.getElementById("btn-cancel-no-masking");
    if (cancelBtn) cancelBtn.addEventListener("click", closeNoMaskingModal);
    const form = document.getElementById("no-masking-form");
    if (form) form.addEventListener("submit", submitNoMasking);
  }

  // Action Panel buttons
  document.getElementById("btn-start-cycle").addEventListener("click", () => {
    if (selectedJobKp) openAssignModal(selectedJobKp);
  });
  document.getElementById("btn-pause-cycle").addEventListener("click", pauseMaskingCycle);
  document.getElementById("btn-resume-cycle").addEventListener("click", resumeMaskingCycle);
  document.getElementById("btn-end-cycle").addEventListener("click", endMaskingCycle);

  // Complete Masking modal triggers
  document.getElementById("btn-close-complete-masking").addEventListener("click", closeCompleteMaskingModal);
  document.getElementById("btn-cancel-complete-masking").addEventListener("click", closeCompleteMaskingModal);
  document.getElementById("masking-complete-form").addEventListener("submit", submitCompleteMasking);

  // Material forms
  document.getElementById("btn-add-mat-to-job").addEventListener("click", addMaterialToJob);

  // Hold management submits (safe checks as Module 9 is removed)
  const btnSubmitHold = document.getElementById("btn-submit-hold");
  if (btnSubmitHold) btnSubmitHold.addEventListener("click", submitHoldJob);
  const btnSubmitResume = document.getElementById("btn-submit-resume");
  if (btnSubmitResume) btnSubmitResume.addEventListener("click", submitResumeJob);

  // Pause Modal listeners
  const closePauseBtn = document.getElementById("btn-close-pause-masking");
  if (closePauseBtn) closePauseBtn.addEventListener("click", closePauseMaskingModal);
  const cancelPauseBtn = document.getElementById("btn-cancel-pause-masking");
  if (cancelPauseBtn) cancelPauseBtn.addEventListener("click", closePauseMaskingModal);
  const pauseForm = document.getElementById("masking-pause-form");
  if (pauseForm) pauseForm.addEventListener("submit", submitPauseMasking);

  // Filters Queue listeners
  document.getElementById("filter-kp").addEventListener("input", renderLiveJobQueue);
  if (document.getElementById("filter-jc")) {
    document.getElementById("filter-jc").addEventListener("input", renderLiveJobQueue);
  }
  document.getElementById("filter-customer").addEventListener("input", renderLiveJobQueue);
  document.getElementById("filter-process").addEventListener("change", renderLiveJobQueue);
  document.getElementById("filter-status").addEventListener("change", renderLiveJobQueue);
  document.getElementById("btn-clear-filters").addEventListener("click", () => {
    document.getElementById("filter-kp").value = "";
    if (document.getElementById("filter-jc")) {
      document.getElementById("filter-jc").value = "";
    }
    document.getElementById("filter-customer").value = "";
    document.getElementById("filter-process").value = "";
    document.getElementById("filter-status").value = "";
    renderLiveJobQueue();
  });

  // Filters History listeners
  document.getElementById("hist-filter-kp").addEventListener("input", renderJobHistory);
  document.getElementById("hist-filter-customer").addEventListener("input", renderJobHistory);
  document.getElementById("hist-filter-operator").addEventListener("input", renderJobHistory);
  document.getElementById("hist-filter-process").addEventListener("change", renderJobHistory);
  document.getElementById("btn-clear-hist-filters").addEventListener("click", () => {
    document.getElementById("hist-filter-kp").value = "";
    document.getElementById("hist-filter-customer").value = "";
    document.getElementById("hist-filter-operator").value = "";
    document.getElementById("hist-filter-process").value = "";
    renderJobHistory();
  });

  // Final Inspection Filters listeners
  if (document.getElementById("final-filter-kp")) {
    document.getElementById("final-filter-kp").addEventListener("input", renderFinalInspectionDashboard);
  }
  if (document.getElementById("final-filter-jc")) {
    document.getElementById("final-filter-jc").addEventListener("input", renderFinalInspectionDashboard);
  }
  if (document.getElementById("final-filter-customer")) {
    document.getElementById("final-filter-customer").addEventListener("input", renderFinalInspectionDashboard);
  }
  if (document.getElementById("final-filter-process")) {
    document.getElementById("final-filter-process").addEventListener("change", renderFinalInspectionDashboard);
  }
  if (document.getElementById("final-filter-status")) {
    document.getElementById("final-filter-status").addEventListener("change", renderFinalInspectionDashboard);
  }
  if (document.getElementById("btn-clear-final-filters")) {
    document.getElementById("btn-clear-final-filters").addEventListener("click", () => {
      document.getElementById("final-filter-kp").value = "";
      document.getElementById("final-filter-jc").value = "";
      document.getElementById("final-filter-customer").value = "";
      document.getElementById("final-filter-process").value = "";
      document.getElementById("final-filter-status").value = "";
      renderFinalInspectionDashboard();
    });
  }

  // Dynamic Inspection Google Sheet Listeners
  document.getElementById("inspect-kp-no").addEventListener("change", () => {
    updateInspectionDropdowns();
  });
  document.getElementById("inspect-part-name").addEventListener("change", () => {
    updateInspectionDropdowns();
  });
  document.getElementById("inspect-customer").addEventListener("change", () => {
    updateInspectionDropdowns();
  });
  document.getElementById("inspect-quantity").addEventListener("change", () => {
    updateInspectionDropdowns();
  });

  const btnRefreshInspection = document.getElementById("btn-refresh-inspection");
  if (btnRefreshInspection) {
    btnRefreshInspection.addEventListener("click", async () => {
      const originalText = btnRefreshInspection.innerHTML;
      btnRefreshInspection.disabled = true;
      btnRefreshInspection.innerHTML = '<span>🔄</span> LOADING...';
      try {
        await loadInspectionKPs(true);
      } finally {
        btnRefreshInspection.disabled = false;
        btnRefreshInspection.innerHTML = originalText;
      }
    });
  }

  // Admin Inspection Workload Tracking Filters
  const filterOpEl = document.getElementById("admin-filter-operator");
  const filterStatEl = document.getElementById("admin-filter-status");
  if (filterOpEl) {
    filterOpEl.addEventListener("change", renderAdminInspectionTracking);
  }
  if (filterStatEl) {
    filterStatEl.addEventListener("change", renderAdminInspectionTracking);
  }

  // Simulation Inspection Job Registry form
  document.getElementById("inspection-job-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const kpNo = document.getElementById("inspect-kp-no").value.trim();
    const partName = document.getElementById("inspect-part-name").value.trim();
    const cust = document.getElementById("inspect-customer").value.trim();
    const qty = parseInt(document.getElementById("inspect-quantity").value);
    const proc = document.getElementById("inspect-process-type").value;
    const prio = document.getElementById("inspect-priority").value;

    // Check validation against activeInspectionRecord to prevent forged combinations
    if (!activeInspectionRecord || 
        activeInspectionRecord.kpNo !== kpNo || 
        activeInspectionRecord.partName !== partName || 
        activeInspectionRecord.customer !== cust || 
        parseInt(activeInspectionRecord.quantity) !== qty) {
      alert("Validation Error: Invalid record data combination. Please re-select the KP Number.");
      return;
    }

    // Check duplicate
    const exists = jobs.some(j => j.kpNumber.toLowerCase() === kpNo.toLowerCase());
    if (exists) {
      alert("A job with this KP Number already exists in the system.");
      return;
    }

    const payload = {
      type: "CREATE_JOB",
      kpNo: kpNo,
      partName: partName,
      customer: cust,
      quantity: qty,
      processType: proc,
      priority: prio,
      inspectionDate: new Date().toISOString().split('T')[0]
    };

    // Optimistic UI mutation
    const newJob = {
      kpNumber: kpNo,
      partName: partName,
      customer: cust,
      quantity: qty,
      processType: proc,
      priority: prio,
      inspectionDate: new Date().toISOString().split('T')[0],
      receivedDate: new Date().toISOString().split('T')[0],
      currentDepartment: "Inspection",
      status: "Pending",
      masking: { status: "Pending", materials: [], holdHistory: [] },
      spraying: { status: "Pending" },
      grinding: { status: "Pending" },
      polishing: { status: "Pending" },
      finalInspection: { status: "Pending" },
      dispatch: { status: "Pending" }
    };
    jobs.push(newJob);

    // Reset Form & render instantly
    document.getElementById("inspection-job-form").reset();
    document.getElementById("inspect-customer").value = "";
    document.getElementById("inspect-part-name").value = "";
    document.getElementById("inspect-quantity").value = "";
    activeInspectionRecord = null;
    renderAll();

    // Background sync
    pendingSyncCount++;
    sendBackendPost(payload)
      .then(() => {
        pendingSyncCount--;
        if (pendingSyncCount === 0) {
          return loadState().then(() => renderAll());
        }
      })
      .catch(err => {
        pendingSyncCount--;
        console.error("Failed to sync job creation:", err);
        let errorMsg = "Failed to register job card: " + (err.message || err);
        if (err.message && err.message.toLowerCase().includes("permission")) {
          errorMsg = "Security Error: Missing or insufficient permissions.\n\nThis usually means your account role in the live database is still 'Operator' instead of 'Quality Admin'. Please ask the Administrator to assign you the 'Quality Admin' role in the User Profiles tab of the dashboard.";
        }
        alert(errorMsg);
        if (pendingSyncCount === 0) {
          // Rollback if failed
          jobs = jobs.filter(j => j.kpNumber !== kpNo);
          renderAll();
        }
      });
  });


  // System Controls
  document.getElementById("btn-reset-data").addEventListener("click", resetData);
  document.getElementById("btn-theme-toggle").addEventListener("click", toggleTheme);
  document.getElementById("btn-export-logs").addEventListener("click", () => {
    console.log("MES SHOP FLOOR AUDIT LOG:");
    console.table(auditLogs);
    alert("Audit log exported to Browser Developer Console (Ctrl+Shift+I or F12).");
  });

  // Logout event
  const logoutBtn = document.getElementById("btn-sidebar-logout") || document.getElementById("btn-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      createAuditLog(currentUser.email, null, "Logout Success");
      localStorage.removeItem("psp_logged_in_user");
      window.location.href = "login.html";
    });
  }

  // Access Denied Modal Close
  const closeAccessDeniedBtn = document.getElementById("btn-close-access-denied");
  if (closeAccessDeniedBtn) {
    closeAccessDeniedBtn.addEventListener("click", () => {
      document.getElementById("access-denied-modal").classList.remove("active");
    });
  }

  // User Management Role select filter
  const userRoleSelect = document.getElementById("user-role");
  if (userRoleSelect) {
    userRoleSelect.addEventListener("change", (e) => {
      const role = e.target.value;
      const deptSelect = document.getElementById("user-dept");
      if (deptSelect) {
        deptSelect.innerHTML = "";
        if (role === 'operator') {
          deptSelect.innerHTML = `
            <option value="Masking">Masking Operator</option>
            <option value="Spraying">Spraying Operator</option>
            <option value="Grinding">Grinding Operator</option>
            <option value="Polishing">Polishing Operator</option>
          `;
        } else {
          deptSelect.innerHTML = `
            <option value="All">All Departments (Admins / HR / Quality)</option>
            <option value="Production">Production</option>
            <option value="HR">HR</option>
            <option value="Quality">Quality</option>
          `;
        }
      }
    });
  }

  // User creation form submit
  const userForm = document.getElementById("user-creation-form");
  if (userForm) {
    userForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("user-email").value.trim();
      const password = document.getElementById("user-password").value;
      const confirmPass = document.getElementById("user-confirm-password").value;
      const role = document.getElementById("user-role").value;
      const department = document.getElementById("user-dept").value;
      
      if (password !== confirmPass) {
        alert("Security PINs do not match.");
        return;
      }
      if (!/^[0-9]{6}$/.test(password)) {
        alert("Security PIN must be exactly 6 digits.");
        return;
      }
      
      // === COMPANY EMAIL DOMAIN RESTRICTION ===
      var ALLOWED_DOMAIN = '@plasmaspray.co.in';
      if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
        alert("Access Denied. Only @plasmaspray.co.in email addresses are allowed.");
        return;
      }
      
      const isMock = isMockMode();
      const activeUsers = isMock ? MOCK_DB.getUsers() : users;
      
      // Singleton super admin check
      if (role === 'super_admin') {
        const hasSuper = activeUsers.some(u => u.role === 'super_admin');
        if (hasSuper) {
          alert("Super Admin account already exists.");
          return;
        }
      }
      
      if (activeUsers.some(u => u.email.toLowerCase() === email.toLowerCase())) {
        alert("A user with this email is already registered.");
        return;
      }
      
      const newUid = isMock ? "uid-" + Math.random().toString(36).substr(2, 9) : firebase.firestore().collection("users").doc().id;

      const newUser = {
        uid: newUid,
        email,
        role,
        department: role === 'super_admin' ? 'All' : department,
        active: true,
        pin: password
      };
      
      MOCK_DB.addUser(newUser, password);
      
      if (!isMock) {
        try {
          const db = firebase.firestore();
          await db.collection("users").doc(newUid).set({
            uid: newUid,
            name: email.split('@')[0],
            email,
            role,
            department: newUser.department,
            active: true,
            emailVerified: true,
            pin: password,
            createdAt: new Date().toISOString()
          });
        } catch (err) {
          console.error("Firestore user creation sync error:", err);
          handleFirestoreError("user-creation-write", err);
        }
      }
      
      createAuditLog(currentUser.email, null, `Created access profile for user: ${email} (${role.toUpperCase()})`);
      userForm.reset();
      renderAll();
      alert("User profile provisioned successfully.");
    });
  }

  // === GRINDING EVENT LISTENERS ===
  // Grinding Queue Filters
  const grindFilterKp = document.getElementById("grinding-filter-kp");
  if (grindFilterKp) grindFilterKp.addEventListener("input", renderGrindingLiveQueue);

  const grindFilterJc = document.getElementById("grinding-filter-jc");
  if (grindFilterJc) grindFilterJc.addEventListener("input", renderGrindingLiveQueue);
  
  const grindFilterCust = document.getElementById("grinding-filter-customer");
  if (grindFilterCust) grindFilterCust.addEventListener("input", renderGrindingLiveQueue);
  
  const grindFilterMach = document.getElementById("grinding-filter-machine");
  if (grindFilterMach) grindFilterMach.addEventListener("change", renderGrindingLiveQueue);
  
  const grindFilterProc = document.getElementById("grinding-filter-process");
  if (grindFilterProc) grindFilterProc.addEventListener("change", renderGrindingLiveQueue);
  
  const grindClearFilters = document.getElementById("btn-grinding-clear-filters");
  if (grindClearFilters) {
    grindClearFilters.addEventListener("click", () => {
      document.getElementById("grinding-filter-kp").value = "";
      if (document.getElementById("grinding-filter-jc")) document.getElementById("grinding-filter-jc").value = "";
      document.getElementById("grinding-filter-customer").value = "";
      document.getElementById("grinding-filter-machine").value = "";
      document.getElementById("grinding-filter-process").value = "";
      renderGrindingLiveQueue();
    });
  }

  // Grinding History Filters
  const grindHistFilterKp = document.getElementById("grinding-hist-filter-kp");
  if (grindHistFilterKp) grindHistFilterKp.addEventListener("input", renderGrindingHistory);
  
  const grindHistFilterCust = document.getElementById("grinding-hist-filter-customer");
  if (grindHistFilterCust) grindHistFilterCust.addEventListener("input", renderGrindingHistory);
  
  const grindHistFilterMach = document.getElementById("grinding-hist-filter-machine");
  if (grindHistFilterMach) grindHistFilterMach.addEventListener("input", renderGrindingHistory);
  
  const grindHistFilterProc = document.getElementById("grinding-hist-filter-process");
  if (grindHistFilterProc) grindHistFilterProc.addEventListener("change", renderGrindingHistory);
  
  const grindClearHistFilters = document.getElementById("btn-grinding-clear-hist-filters");
  if (grindClearHistFilters) {
    grindClearHistFilters.addEventListener("click", () => {
      document.getElementById("grinding-hist-filter-kp").value = "";
      document.getElementById("grinding-hist-filter-customer").value = "";
      document.getElementById("grinding-hist-filter-machine").value = "";
      document.getElementById("grinding-hist-filter-process").value = "";
      renderGrindingHistory();
    });
  }

  // Grinding Active Station cycle control buttons
  const btnGrindStart = document.getElementById("btn-grinding-start-cycle");
  if (btnGrindStart) {
    btnGrindStart.addEventListener("click", () => {
      if (selectedGrindingJobKp) openStartGrindingModal(selectedGrindingJobKp);
    });
  }

  const btnGrindPause = document.getElementById("btn-grinding-pause-cycle");
  if (btnGrindPause) btnGrindPause.addEventListener("click", pauseGrindingCycle);
  
  const btnGrindResume = document.getElementById("btn-grinding-resume-cycle");
  if (btnGrindResume) btnGrindResume.addEventListener("click", resumeGrindingCycle);
  
  const btnGrindEnd = document.getElementById("btn-grinding-end-cycle");
  if (btnGrindEnd) btnGrindEnd.addEventListener("click", endGrindingCycle);

  // Grinding Modals forms
  const grindStartForm = document.getElementById("grinding-start-form");
  if (grindStartForm) grindStartForm.addEventListener("submit", submitStartGrinding);
  
  const grindPauseForm = document.getElementById("grinding-pause-form");
  if (grindPauseForm) grindPauseForm.addEventListener("submit", submitPauseGrinding);
  
  const grindCompleteForm = document.getElementById("grinding-complete-form");
  if (grindCompleteForm) grindCompleteForm.addEventListener("submit", submitCompleteGrinding);

  // Grinding Modals Cancel & Close
  const closeStartGrind = document.getElementById("btn-close-start-grinding");
  if (closeStartGrind) closeStartGrind.addEventListener("click", closeGrindingStartModal);
  const cancelStartGrind = document.getElementById("btn-cancel-start-grinding");
  if (cancelStartGrind) cancelStartGrind.addEventListener("click", closeGrindingStartModal);

  const closePauseGrind = document.getElementById("btn-close-pause-grinding");
  if (closePauseGrind) closePauseGrind.addEventListener("click", closeGrindingPauseModal);
  const cancelPauseGrind = document.getElementById("btn-cancel-pause-grinding");
  if (cancelPauseGrind) cancelPauseGrind.addEventListener("click", closeGrindingPauseModal);

  const closeCompleteGrind = document.getElementById("btn-close-complete-grinding");
  if (closeCompleteGrind) closeCompleteGrind.addEventListener("click", closeGrindingCompleteModal);
  const cancelCompleteGrind = document.getElementById("btn-cancel-complete-grinding");
  if (cancelCompleteGrind) cancelCompleteGrind.addEventListener("click", closeGrindingCompleteModal);
}

// =========================================================================
// IT DATA MANAGEMENT DASHBOARD (DMD) - CONTROLLERS & RENDERING
// =========================================================================

let dmdSelectedEntity = null;
let dmdSelectedAction = null;

function setupDmdEventListeners() {
  const dmdSubtabButtons = document.querySelectorAll(".dmd-subtab-btn");
  dmdSubtabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      dmdSubtabButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      const targetSubtab = btn.getAttribute("data-subtab");
      activeDmdDSubtab = targetSubtab; // save state
      
      const contents = document.querySelectorAll(".dmd-subtab-content");
      contents.forEach(c => {
        if (c.id === targetSubtab) {
          c.classList.remove("hidden");
        } else {
          c.classList.add("hidden");
        }
      });
    });
  });

  const crudForm = document.getElementById("dmd-crud-form");
  if (crudForm) {
    crudForm.addEventListener("submit", submitCrudForm);
  }
}

function renderDmdDashboard() {
  const dmdPane = document.getElementById("tab-data-management");
  if (!dmdPane || !dmdPane.classList.contains("active")) return;

  // 1. Telemetry metrics
  const activeSessions = users.filter(u => u.active).length;
  
  const countInspect = jobs.filter(j => j.currentDepartment === "Inspection").length;
  const countMasking = jobs.filter(j => j.currentDepartment === "Masking" && j.masking?.status !== "Completed").length;
  const countSpraying = jobs.filter(j => j.currentDepartment === "Spraying" && j.spraying?.status !== "Completed").length;
  const countGrinding = jobs.filter(j => j.currentDepartment === "Grinding" && j.grinding?.status !== "Completed").length;
  const countPolishing = jobs.filter(j => j.currentDepartment === "Polishing" && j.polishing?.status !== "Completed").length;
  const countFinal = jobs.filter(j => j.currentDepartment === "Final Inspection" && j.finalInspection?.status !== "Completed").length;
  const countDispatch = jobs.filter(j => j.currentDepartment === "Dispatch" && j.dispatch?.status !== "Completed").length;
  const totalActiveStageJobs = countInspect + countMasking + countSpraying + countGrinding + countPolishing + countFinal + countDispatch;

  document.getElementById("dmd-telemetry-jobs-count").textContent = jobs.length;
  document.getElementById("dmd-telemetry-users-count").textContent = users.length;
  document.getElementById("dmd-telemetry-audit-count").textContent = auditLogs.length;
  document.getElementById("dmd-telemetry-active-sessions").textContent = activeSessions;
  
  const activePipelineEl = document.getElementById("dmd-telemetry-active-pipeline-count");
  if (activePipelineEl) activePipelineEl.textContent = totalActiveStageJobs;

  // 2. Health & Latency
  const firestoreStatusEl = document.getElementById("dmd-health-firestore-status");
  if (firestoreStatusEl) {
    if (isMockMode()) {
      firestoreStatusEl.textContent = "MOCK MODE";
      firestoreStatusEl.className = "badge badge-hold";
    } else {
      firestoreStatusEl.textContent = "CONNECTED";
      firestoreStatusEl.className = "badge badge-completed";
    }
  }
  document.getElementById("dmd-health-heartbeat").textContent = new Date().toLocaleTimeString();

  // 3. Error Console
  const errorTbody = document.getElementById("dmd-error-console-body");
  if (errorTbody) {
    errorTbody.innerHTML = "";
    const errors = window.errorLogsData || [];
    if (errors.length === 0) {
      errorTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No system errors logged.</td></tr>`;
    } else {
      errors.forEach(e => {
        const tr = document.createElement("tr");
        const ts = e.timestamp?.toDate ? e.timestamp.toDate().toLocaleString() : (e.timestamp || "N/A");
        tr.innerHTML = `
          <td class="font-mono" style="font-size:11px;">${ts}</td>
          <td class="font-mono" style="font-size:11px;">${e.userId || 'N/A'}</td>
          <td><strong>${e.path || 'N/A'}</strong></td>
          <td class="text-danger" style="font-size:12px;">${e.errorMessage || ''}</td>
        `;
        errorTbody.appendChild(tr);
      });
    }
  }

  // 4. Live Job Monitoring
  const jobsTbody = document.getElementById("dmd-live-jobs-body");
  if (jobsTbody) {
    jobsTbody.innerHTML = "";
    if (jobs.length === 0) {
      jobsTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No jobs in factory.</td></tr>`;
    } else {
      jobs.forEach(j => {
        const tr = document.createElement("tr");
        let badgeClass = "badge-pending";
        if (j.status === "In Progress") badgeClass = "badge-completed";
        else if (j.status === "Hold") badgeClass = "badge-hold";
        
        tr.innerHTML = `
          <td class="font-mono"><strong>${j.kpNumber}${getJobJcNo(j) ? ` (${getJobJcNo(j)})` : ""}</strong></td>
          <td>
            <div>${j.partName}</div>
            <div class="text-xs text-muted" style="font-size:11px;">${j.customer} (Qty: ${j.quantity})</div>
          </td>
          <td><span class="badge" style="background:rgba(255,255,255,0.05);">${j.currentDepartment}</span></td>
          <td><span class="badge ${badgeClass}">${j.status}</span></td>
          <td>${j.operatorName || 'None'}</td>
          <td class="font-mono">${j.storeLocation || 'N/A'}</td>
        `;
        jobsTbody.appendChild(tr);
      });
    }
  }

  // 5. Live Stage Monitoring
  const stageContainer = document.getElementById("dmd-stage-monitoring-container");
  if (stageContainer) {
    stageContainer.innerHTML = "";
    const stagesList = ["Inspection", "Masking", "Spraying", "Grinding", "Polishing", "Final Inspection", "Dispatch"];
    stagesList.forEach(s => {
      const count = jobs.filter(j => j.currentDepartment === s).length;
      const running = jobs.filter(j => j.currentDepartment === s && j.status === "In Progress").length;
      
      const div = document.createElement("div");
      div.className = "kpi-card";
      div.style.padding = "10px 15px";
      div.style.borderLeftColor = count > 0 ? "var(--accent-color)" : "var(--border-color)";
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>${s} Stage</strong>
          <span class="badge" style="background:rgba(255,255,255,0.05); font-size:14px; font-weight:bold;">${count} Total</span>
        </div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">
          Running: ${running} | Idle/Pending: ${count - running}
        </div>
      `;
      stageContainer.appendChild(div);
    });
  }

  // 6. Live Machine Monitoring
  const machinesTbody = document.getElementById("dmd-live-machines-body");
  if (machinesTbody) {
    machinesTbody.innerHTML = "";
    if (machines.length === 0) {
      machinesTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No machines registered.</td></tr>`;
    } else {
      machines.forEach(m => {
        const tr = document.createElement("tr");
        let badgeClass = "badge-pending";
        if (m.status === "running") badgeClass = "badge-completed";
        else if (m.status === "maintenance") badgeClass = "badge-hold";
        
        tr.innerHTML = `
          <td><strong>${m.name || m.machineId}</strong></td>
          <td><span class="badge ${badgeClass}">${m.status}</span></td>
          <td>${m.currentOperator?.email || 'None'}</td>
          <td class="font-mono">${m.currentJobId || 'None'}</td>
        `;
        machinesTbody.appendChild(tr);
      });
    }
  }

  // 7. Material Consumption Ledger
  const ledgerTbody = document.getElementById("dmd-material-ledger-body");
  if (ledgerTbody) {
    ledgerTbody.innerHTML = "";
    let ledger = [];
    jobs.forEach(j => {
      if (j.masking && j.masking.materials) {
        j.masking.materials.forEach(m => {
          if (m.actualQty > 0) {
            ledger.push({
              timestamp: j.masking.endTime || new Date().toISOString(),
              kpNo: j.kpNumber,
              stage: "Masking",
              name: m.name,
              planned: m.plannedQty,
              actual: m.actualQty,
              unit: m.unit,
              operator: j.masking.operatorName || "Operator"
            });
          }
        });
      }
      if (j.spraying && j.spraying.status === "Completed") {
        ledger.push({
          timestamp: j.spraying.endTime || new Date().toISOString(),
          kpNo: j.kpNumber,
          stage: "Spraying",
          name: "Powder Consumed",
          planned: 0,
          actual: j.spraying.powderConsumed || 0,
          unit: "KG",
          operator: "Spraying Operator"
        });
      }
    });
    
    if (ledger.length === 0) {
      ledgerTbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No material consumption logged yet.</td></tr>`;
    } else {
      ledger.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
      ledger.forEach(item => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="font-mono" style="font-size:11px;">${new Date(item.timestamp).toLocaleString()}</td>
          <td class="font-mono"><strong>${item.kpNo}</strong></td>
          <td>${item.stage}</td>
          <td>${item.name}</td>
          <td class="font-mono">${item.planned}</td>
          <td class="font-mono text-cyan">${item.actual}</td>
          <td>${item.unit}</td>
          <td>${item.operator}</td>
        `;
        ledgerTbody.appendChild(tr);
      });
    }
  }

  // 8. Live Operator Monitoring
  const opsTbody = document.getElementById("dmd-live-operators-body");
  if (opsTbody) {
    opsTbody.innerHTML = "";
    const ops = users.filter(u => u.role === 'operator' || u.role === 'pending');
    if (ops.length === 0) {
      opsTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No operators active.</td></tr>`;
    } else {
      ops.forEach(o => {
        const tr = document.createElement("tr");
        let badgeClass = o.active ? "badge-completed" : "badge-pending";
        tr.innerHTML = `
          <td><strong>${o.name || o.email}</strong></td>
          <td class="font-mono">${o.shift || 'N/A'}</td>
          <td>${o.department || 'pending'}</td>
          <td><span class="badge ${badgeClass}">${o.active ? 'Active' : 'Pending'}</span></td>
        `;
        opsTbody.appendChild(tr);
      });
    }
  }

  // 9. Real-Time Audit Log Feed
  const auditTbody = document.getElementById("dmd-live-audit-body");
  if (auditTbody) {
    auditTbody.innerHTML = "";
    if (auditLogs.length === 0) {
      auditTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No audit events recorded.</td></tr>`;
    } else {
      auditLogs.slice(0, 15).forEach(log => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="font-mono" style="font-size:11px;">${new Date(log.timestamp).toLocaleTimeString()}</td>
          <td><strong>${log.user}</strong> <span class="text-muted">(${log.role})</span></td>
          <td><span class="badge" style="background:rgba(255,255,255,0.05);">${log.department}</span></td>
          <td style="font-size:12px;">${log.action}</td>
        `;
        auditTbody.appendChild(tr);
      });
    }
  }

  // 10. IT User Authorization elevation
  const userTbody = document.getElementById("dmd-user-table-body");
  if (userTbody) {
    userTbody.innerHTML = "";
    if (users.length === 0) {
      userTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No users in database.</td></tr>`;
    } else {
      users.forEach(user => {
        const tr = document.createElement("tr");
        let statusText = user.active ? "Active" : "Pending";
        let badgeClass = user.active ? "badge-completed" : "badge-pending";
        const isSelf = currentUser && currentUser.email.toLowerCase() === user.email.toLowerCase();
        
        const roles = [
          { val: "pending", label: "Pending" },
          { val: "operator", label: "Operator" },
          { val: "production_admin", label: "Production Admin" },
          { val: "hr_admin", label: "HR Admin" },
          { val: "quality_admin", label: "Quality Admin" },
          { val: "it_team", label: "IT Team" },
          { val: "super_admin", label: "Super Admin" }
        ];
        let roleSelectHtml = `<select id="dmd-user-role-select-${user.uid}" class="form-input select-sm" ${isSelf ? 'disabled' : ''} style="height:32px; padding:2px 5px; font-size:12px;">`;
        roles.forEach(r => {
          roleSelectHtml += `<option value="${r.val}" ${user.role === r.val ? 'selected' : ''}>${r.label}</option>`;
        });
        roleSelectHtml += `</select>`;

        const depts = [
          { val: "pending", label: "Pending" },
          { val: "Masking", label: "Masking" },
          { val: "Spraying", label: "Spraying" },
          { val: "Grinding", label: "Grinding" },
          { val: "Polishing", label: "Polishing" },
          { val: "Inspection", label: "Inspection" },
          { val: "All", label: "All Departments" }
        ];
        let deptSelectHtml = `<select id="dmd-user-dept-select-${user.uid}" class="form-input select-sm" ${isSelf ? 'disabled' : ''} style="height:32px; padding:2px 5px; font-size:12px;">`;
        depts.forEach(d => {
          deptSelectHtml += `<option value="${d.val}" ${user.department === d.val ? 'selected' : ''}>${d.label}</option>`;
        });
        deptSelectHtml += `</select>`;

        tr.innerHTML = `
          <td>
            <div style="font-weight:bold;">${user.name || 'No Name'}</div>
            <div class="text-xs text-muted" style="font-size:11px;">${user.email}</div>
          </td>
          <td><span class="badge ${user.emailVerified ? 'badge-completed' : 'badge-pending'}">${user.emailVerified ? 'Yes' : 'No'}</span></td>
          <td>${roleSelectHtml}</td>
          <td>${deptSelectHtml}</td>
          <td><span class="badge ${badgeClass}">${statusText}</span></td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-success btn-xs" onclick="saveAndApproveUserDmd('${user.uid}')" ${isSelf ? 'disabled style="opacity:0.5"' : ''}>Save</button>
              <button class="btn btn-warning btn-xs" onclick="toggleUserStatusDmd('${user.uid}')" ${isSelf ? 'disabled style="opacity:0.5"' : ''}>Status</button>
            </div>
          </td>
        `;
        userTbody.appendChild(tr);
      });
    }
  }
}

function openCrudModal(entity, action) {
  dmdSelectedEntity = entity;
  dmdSelectedAction = action;

  const modal = document.getElementById("dmd-crud-modal");
  const title = document.getElementById("dmd-crud-modal-title");
  const fieldsDiv = document.getElementById("dmd-crud-form-fields");
  
  if (!modal || !title || !fieldsDiv) return;
  
  title.textContent = `${action.toUpperCase()} ${entity.toUpperCase()}`;
  fieldsDiv.innerHTML = "";
  
  let fieldsHtml = "";
  
  if (entity === 'job') {
    if (action === 'create') {
      fieldsHtml = `
        <div class="form-group"><label>KP Number *</label><input type="text" id="crud-job-kp" class="form-input" required placeholder="e.g. KP-1020"></div>
        <div class="form-group"><label>Part Name *</label><input type="text" id="crud-job-part" class="form-input" required placeholder="e.g. Turbine Impeller"></div>
        <div class="form-group"><label>Customer *</label><input type="text" id="crud-job-customer" class="form-input" required placeholder="e.g. ISRO"></div>
        <div class="form-group"><label>Quantity *</label><input type="number" id="crud-job-qty" class="form-input" required value="1" min="1"></div>
        <div class="form-group"><label>Process Type *</label>
          <select id="crud-job-process" class="form-input">
            <option value="Plasma">Plasma</option>
            <option value="HCOS">HCOS</option>
            <option value="HVOF">HVOF</option>
          </select>
        </div>
        <div class="form-group"><label>Priority *</label>
          <select id="crud-job-priority" class="form-input">
            <option value="Normal">Normal</option>
            <option value="High">High</option>
            <option value="Critical">Critical</option>
          </select>
        </div>
        <div class="form-group"><label>Initial Stage *</label>
          <select id="crud-job-stage" class="form-input">
            <option value="Inspection">Inspection</option>
            <option value="Masking">Masking</option>
            <option value="Spraying">Spraying</option>
            <option value="Grinding">Grinding</option>
            <option value="Polishing">Polishing</option>
          </select>
        </div>
        <div class="form-group"><label>Store Location</label><input type="text" id="crud-job-store" class="form-input" placeholder="e.g. A10"></div>
      `;
    } else if (action === 'edit') {
      let jobOptions = jobs.map(j => `<option value="${j.kpNumber}">${j.kpNumber}${getJobJcNo(j) ? ` (${getJobJcNo(j)})` : ""} (${j.partName})</option>`).join("");
      fieldsHtml = `
        <div class="form-group"><label>Select Job to Edit *</label>
          <select id="crud-job-select" class="form-input" onchange="loadCrudJobDetails(this.value)">
            <option value="">-- Choose Job --</option>
            ${jobOptions}
          </select>
        </div>
        <div id="crud-job-edit-details" class="hidden" style="display: flex; flex-direction: column; gap: 15px;"></div>
      `;
    } else if (action === 'delete') {
      let jobOptions = jobs.map(j => `<option value="${j.kpNumber}">${j.kpNumber}${getJobJcNo(j) ? ` (${getJobJcNo(j)})` : ""} (${j.partName})</option>`).join("");
      fieldsHtml = `
        <div class="form-group"><label>Select Job to Delete *</label>
          <select id="crud-job-select" class="form-input" required>
            <option value="">-- Choose Job --</option>
            ${jobOptions}
          </select>
        </div>
      `;
    }
  }
  
  else if (entity === 'machine') {
    if (action === 'create') {
      fieldsHtml = `
        <div class="form-group"><label>Machine ID *</label><input type="text" id="crud-machine-id" class="form-input" required placeholder="e.g. hmt_g17"></div>
        <div class="form-group"><label>Name *</label><input type="text" id="crud-machine-name" class="form-input" required placeholder="e.g. HMT G17"></div>
        <div class="form-group"><label>Type *</label><input type="text" id="crud-machine-type" class="form-input" required placeholder="e.g. Grinding Machine"></div>
        <div class="form-group"><label>Department Owner *</label><input type="text" id="crud-machine-dept" class="form-input" required placeholder="e.g. Grinding"></div>
        <div class="form-group"><label>Status *</label>
          <select id="crud-machine-status" class="form-input">
            <option value="idle">idle</option>
            <option value="running">running</option>
            <option value="maintenance">maintenance</option>
            <option value="offline">offline</option>
          </select>
        </div>
      `;
    } else if (action === 'edit') {
      let machOptions = machines.map(m => `<option value="${m.machineId}">${m.name}</option>`).join("");
      fieldsHtml = `
        <div class="form-group"><label>Select Machine to Edit *</label>
          <select id="crud-machine-select" class="form-input" onchange="loadCrudMachineDetails(this.value)">
            <option value="">-- Choose Machine --</option>
            ${machOptions}
          </select>
        </div>
        <div id="crud-machine-edit-details" class="hidden" style="display: flex; flex-direction: column; gap: 15px;"></div>
      `;
    } else if (action === 'delete') {
      let machOptions = machines.map(m => `<option value="${m.machineId}">${m.name}</option>`).join("");
      fieldsHtml = `
        <div class="form-group"><label>Select Machine to Delete *</label>
          <select id="crud-machine-select" class="form-input" required>
            <option value="">-- Choose Machine --</option>
            ${machOptions}
          </select>
        </div>
      `;
    }
  }
  
  else if (entity === 'material') {
    if (action === 'create') {
      fieldsHtml = `
        <div class="form-group"><label>Material ID *</label><input type="text" id="crud-material-id" class="form-input" required placeholder="e.g. silicone_plugs"></div>
        <div class="form-group"><label>Name *</label><input type="text" id="crud-material-name" class="form-input" required placeholder="e.g. Silicone Plugs"></div>
        <div class="form-group"><label>Category *</label><input type="text" id="crud-material-category" class="form-input" required placeholder="e.g. Masking Aid"></div>
        <div class="form-group"><label>Unit of Measure *</label>
          <select id="crud-material-unit" class="form-input">
            <option value="KG">KG</option>
            <option value="Gram">Gram</option>
            <option value="Ltr">Ltr</option>
            <option value="Nos">Nos</option>
          </select>
        </div>
        <div class="form-group"><label>Department *</label><input type="text" id="crud-material-dept" class="form-input" required value="Masking"></div>
      `;
    } else if (action === 'edit') {
      let matOptions = materials.map(m => `<option value="${m.materialId}">${m.name}</option>`).join("");
      fieldsHtml = `
        <div class="form-group"><label>Select Material to Edit *</label>
          <select id="crud-material-select" class="form-input" onchange="loadCrudMaterialDetails(this.value)">
            <option value="">-- Choose Material --</option>
            ${matOptions}
          </select>
        </div>
        <div id="crud-material-edit-details" class="hidden" style="display: flex; flex-direction: column; gap: 15px;"></div>
      `;
    } else if (action === 'delete') {
      let matOptions = materials.map(m => `<option value="${m.materialId}">${m.name}</option>`).join("");
      fieldsHtml = `
        <div class="form-group"><label>Select Material to Delete *</label>
          <select id="crud-material-select" class="form-input" required>
            <option value="">-- Choose Material --</option>
            ${matOptions}
          </select>
        </div>
      `;
    }
  }
  
  else if (entity === 'department') {
    if (action === 'create') {
      fieldsHtml = `
        <div class="form-group"><label>Department Name *</label><input type="text" id="crud-dept-name" class="form-input" required placeholder="e.g. Masking"></div>
        <div class="form-group"><label>Sequence (1-10) *</label><input type="number" id="crud-dept-seq" class="form-input" required value="1" min="1" max="10"></div>
        <div class="form-group"><label>Allowed Store Locations (comma-separated)</label><input type="text" id="crud-dept-locations" class="form-input" placeholder="e.g. M1, M2, M3"></div>
        <div class="form-group"><label>Allowed Pause Reasons (comma-separated)</label><input type="text" id="crud-dept-reasons" class="form-input" placeholder="e.g. Machine Issue, Other"></div>
      `;
    } else if (action === 'edit') {
      let deptsList = window.departmentsList || [];
      let deptOptions = deptsList.map(d => `<option value="${d.name}">${d.name}</option>`).join("");
      fieldsHtml = `
        <div class="form-group"><label>Select Department to Edit *</label>
          <select id="crud-dept-select" class="form-input" onchange="loadCrudDeptDetails(this.value)">
            <option value="">-- Choose Department --</option>
            ${deptOptions}
          </select>
        </div>
        <div id="crud-dept-edit-details" class="hidden" style="display: flex; flex-direction: column; gap: 15px;"></div>
      `;
    } else if (action === 'delete') {
      let deptsList = window.departmentsList || [];
      let deptOptions = deptsList.map(d => `<option value="${d.name}">${d.name}</option>`).join("");
      fieldsHtml = `
        <div class="form-group"><label>Select Department to Delete *</label>
          <select id="crud-dept-select" class="form-input" required>
            <option value="">-- Choose Department --</option>
            ${deptOptions}
          </select>
        </div>
      `;
    }
  }
  
  fieldsDiv.innerHTML = fieldsHtml;
  modal.classList.add("active");
}

function closeCrudModal() {
  const modal = document.getElementById("dmd-crud-modal");
  if (modal) modal.classList.remove("active");
  dmdSelectedEntity = null;
  dmdSelectedAction = null;
}

window.loadCrudJobDetails = function(kp) {
  const job = jobs.find(j => j.kpNumber === kp);
  const detailDiv = document.getElementById("crud-job-edit-details");
  if (job && detailDiv) {
    detailDiv.classList.remove("hidden");
    detailDiv.innerHTML = `
      <div class="form-group"><label>Part Name *</label><input type="text" id="crud-job-part" class="form-input" required value="${job.partName}"></div>
      <div class="form-group"><label>Customer *</label><input type="text" id="crud-job-customer" class="form-input" required value="${job.customer}"></div>
      <div class="form-group"><label>Quantity *</label><input type="number" id="crud-job-qty" class="form-input" required value="${job.quantity}"></div>
      <div class="form-group"><label>Process Type *</label>
        <select id="crud-job-process" class="form-input">
          <option value="Plasma" ${job.processType === 'Plasma' ? 'selected' : ''}>Plasma</option>
          <option value="HCOS" ${job.processType === 'HCOS' ? 'selected' : ''}>HCOS</option>
          <option value="HVOF" ${job.processType === 'HVOF' ? 'selected' : ''}>HVOF</option>
        </select>
      </div>
      <div class="form-group"><label>Priority *</label>
        <select id="crud-job-priority" class="form-input">
          <option value="Normal" ${job.priority === 'Normal' ? 'selected' : ''}>Normal</option>
          <option value="High" ${job.priority === 'High' ? 'selected' : ''}>High</option>
          <option value="Critical" ${job.priority === 'Critical' ? 'selected' : ''}>Critical</option>
        </select>
      </div>
      <div class="form-group"><label>Stage *</label>
        <select id="crud-job-stage" class="form-input">
          <option value="Inspection" ${job.currentDepartment === 'Inspection' ? 'selected' : ''}>Inspection</option>
          <option value="Masking" ${job.currentDepartment === 'Masking' ? 'selected' : ''}>Masking</option>
          <option value="Spraying" ${job.currentDepartment === 'Spraying' ? 'selected' : ''}>Spraying</option>
          <option value="Grinding" ${job.currentDepartment === 'Grinding' ? 'selected' : ''}>Grinding</option>
          <option value="Polishing" ${job.currentDepartment === 'Polishing' ? 'selected' : ''}>Polishing</option>
          <option value="Final Inspection" ${job.currentDepartment === 'Final Inspection' ? 'selected' : ''}>Final Inspection</option>
          <option value="Dispatch" ${job.currentDepartment === 'Dispatch' ? 'selected' : ''}>Dispatch</option>
        </select>
      </div>
      <div class="form-group"><label>Store Location</label><input type="text" id="crud-job-store" class="form-input" value="${job.storeLocation || ''}"></div>
    `;
  } else if (detailDiv) {
    detailDiv.classList.add("hidden");
  }
}

window.loadCrudMachineDetails = function(id) {
  const machine = machines.find(m => m.machineId === id);
  const detailDiv = document.getElementById("crud-machine-edit-details");
  if (machine && detailDiv) {
    detailDiv.classList.remove("hidden");
    detailDiv.innerHTML = `
      <div class="form-group"><label>Name *</label><input type="text" id="crud-machine-name" class="form-input" required value="${machine.name}"></div>
      <div class="form-group"><label>Type *</label><input type="text" id="crud-machine-type" class="form-input" required value="${machine.type}"></div>
      <div class="form-group"><label>Department Owner *</label><input type="text" id="crud-machine-dept" class="form-input" required value="${machine.department}"></div>
      <div class="form-group"><label>Status *</label>
        <select id="crud-machine-status" class="form-input">
          <option value="idle" ${machine.status === 'idle' ? 'selected' : ''}>idle</option>
          <option value="running" ${machine.status === 'running' ? 'selected' : ''}>running</option>
          <option value="maintenance" ${machine.status === 'maintenance' ? 'selected' : ''}>maintenance</option>
          <option value="offline" ${machine.status === 'offline' ? 'selected' : ''}>offline</option>
        </select>
      </div>
    `;
  } else if (detailDiv) {
    detailDiv.classList.add("hidden");
  }
}

window.loadCrudMaterialDetails = function(id) {
  const m = materials.find(x => x.materialId === id);
  const detailDiv = document.getElementById("crud-material-edit-details");
  if (m && detailDiv) {
    detailDiv.classList.remove("hidden");
    detailDiv.innerHTML = `
      <div class="form-group"><label>Name *</label><input type="text" id="crud-material-name" class="form-input" required value="${m.name}"></div>
      <div class="form-group"><label>Category *</label><input type="text" id="crud-material-category" class="form-input" required value="${m.category || m.type || ''}"></div>
      <div class="form-group"><label>Unit of Measure *</label>
        <select id="crud-material-unit" class="form-input">
          <option value="KG" ${m.unit === 'KG' ? 'selected' : ''}>KG</option>
          <option value="Gram" ${m.unit === 'Gram' ? 'selected' : ''}>Gram</option>
          <option value="Ltr" ${m.unit === 'Ltr' ? 'selected' : ''}>Ltr</option>
          <option value="Nos" ${m.unit === 'Nos' ? 'selected' : ''}>Nos</option>
        </select>
      </div>
      <div class="form-group"><label>Department *</label><input type="text" id="crud-material-dept" class="form-input" required value="${m.department || 'Masking'}"></div>
    `;
  } else if (detailDiv) {
    detailDiv.classList.add("hidden");
  }
}

window.loadCrudDeptDetails = function(name) {
  const deptsList = window.departmentsList || [];
  const d = deptsList.find(x => x.name === name);
  const detailDiv = document.getElementById("crud-dept-edit-details");
  if (d && detailDiv) {
    detailDiv.classList.remove("hidden");
    const locsStr = Array.isArray(d.allowedStoreLocations) ? d.allowedStoreLocations.join(", ") : (d.allowedStoreLocations || "");
    const reasonsStr = Array.isArray(d.allowedPauseReasons) ? d.allowedPauseReasons.join(", ") : (d.allowedPauseReasons || "");
    detailDiv.innerHTML = `
      <div class="form-group"><label>Sequence (1-10) *</label><input type="number" id="crud-dept-seq" class="form-input" required value="${d.sequence}"></div>
      <div class="form-group"><label>Allowed Store Locations (comma-separated)</label><input type="text" id="crud-dept-locations" class="form-input" value="${locsStr}"></div>
      <div class="form-group"><label>Allowed Pause Reasons (comma-separated)</label><input type="text" id="crud-dept-reasons" class="form-input" value="${reasonsStr}"></div>
    `;
  } else if (detailDiv) {
    detailDiv.classList.add("hidden");
  }
}

async function submitCrudForm(e) {
  e.preventDefault();
  
  const isMock = isMockMode();
  const db = !isMock ? firebase.firestore() : null;
  
  try {
    if (dmdSelectedEntity === 'job') {
      if (dmdSelectedAction === 'create') {
        const kp = document.getElementById("crud-job-kp").value.trim();
        const part = document.getElementById("crud-job-part").value.trim();
        const customer = document.getElementById("crud-job-customer").value.trim();
        const qty = Number(document.getElementById("crud-job-qty").value);
        const process = document.getElementById("crud-job-process").value;
        const priority = document.getElementById("crud-job-priority").value;
        const stage = document.getElementById("crud-job-stage").value;
        const store = document.getElementById("crud-job-store").value.trim();
        
        if (isMock) {
          const newJob = {
            kpNumber: kp, partName: part, customer: customer, quantity: qty,
            processType: process, priority: priority, currentDepartment: stage, status: "Pending",
            storeLocation: store, masking: { status: "Pending", materials: [], holdHistory: [] },
            spraying: { status: "Pending" }, grinding: { status: "Pending", holdHistory: [] }
          };
          jobs.push(newJob);
        } else {
          await db.collection("jobs").doc(`job_${kp}`).set({
            jobId: `job_${kp}`, kpNumber: kp, partName: part, customer: customer, quantity: qty,
            processType: process, priority: priority, currentStage: stage, currentStatus: "Pending",
            storeLocation: store, createdDate: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: currentUser?.email || "System", lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
            masking: { status: "Pending", materials: [], holdHistory: [] },
            spraying: { status: "Pending" }, grinding: { status: "Pending", holdHistory: [] },
            polishing: { status: "Pending" }, finalInspection: { status: "Pending" }, dispatch: { status: "Pending" }
          });
        }
        await createAuditLog(currentUser?.email || "System", kp, `Created Job: ${kp} (${part})`);
        
      } else if (dmdSelectedAction === 'edit') {
        const kp = document.getElementById("crud-job-select").value;
        const part = document.getElementById("crud-job-part").value.trim();
        const customer = document.getElementById("crud-job-customer").value.trim();
        const qty = Number(document.getElementById("crud-job-qty").value);
        const process = document.getElementById("crud-job-process").value;
        const priority = document.getElementById("crud-job-priority").value;
        const stage = document.getElementById("crud-job-stage").value;
        const store = document.getElementById("crud-job-store").value.trim();
        
        if (isMock) {
          const j = jobs.find(x => x.kpNumber === kp);
          if (j) {
            j.partName = part; j.customer = customer; j.quantity = qty;
            j.processType = process; j.priority = priority; j.currentDepartment = stage;
            j.storeLocation = store;
          }
        } else {
          const snap = await db.collection("jobs").where("kpNumber", "==", kp).get();
          if (!snap.empty) {
            await snap.docs[0].ref.update({
              partName: part, customer: customer, quantity: qty,
              processType: process, priority: priority, currentStage: stage,
              storeLocation: store, lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            });
          }
        }
        await createAuditLog(currentUser?.email || "System", kp, `Updated Job: ${kp}`);
        
      } else if (dmdSelectedAction === 'delete') {
        const kp = document.getElementById("crud-job-select").value;
        if (!confirm(`Are you sure you want to delete Job ${kp}?`)) return;
        
        if (isMock) {
          jobs = jobs.filter(x => x.kpNumber !== kp);
        } else {
          const snap = await db.collection("jobs").where("kpNumber", "==", kp).get();
          if (!snap.empty) {
            await snap.docs[0].ref.delete();
          }
        }
        await createAuditLog(currentUser?.email || "System", kp, `Deleted Job: ${kp}`);
      }
    }
    
    else if (dmdSelectedEntity === 'machine') {
      if (dmdSelectedAction === 'create') {
        const id = document.getElementById("crud-machine-id").value.trim();
        const name = document.getElementById("crud-machine-name").value.trim();
        const type = document.getElementById("crud-machine-type").value.trim();
        const dept = document.getElementById("crud-machine-dept").value.trim();
        const status = document.getElementById("crud-machine-status").value;
        
        if (isMock) {
          machines.push({ machineId: id, name, type, department: dept, status });
        } else {
          await db.collection("machines").doc(id).set({
            machineId: id, name, type, department: dept, status, lastMaintenance: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
        await createAuditLog(currentUser?.email || "System", null, `Created Machine: ${name}`);
        
      } else if (dmdSelectedAction === 'edit') {
        const id = document.getElementById("crud-machine-select").value;
        const name = document.getElementById("crud-machine-name").value.trim();
        const type = document.getElementById("crud-machine-type").value.trim();
        const dept = document.getElementById("crud-machine-dept").value.trim();
        const status = document.getElementById("crud-machine-status").value;
        
        if (isMock) {
          const m = machines.find(x => x.machineId === id);
          if (m) {
            m.name = name; m.type = type; m.department = dept; m.status = status;
          }
        } else {
          await db.collection("machines").doc(id).update({
            name, type, department: dept, status
          });
        }
        await createAuditLog(currentUser?.email || "System", null, `Updated Machine: ${name}`);
        
      } else if (dmdSelectedAction === 'delete') {
        const id = document.getElementById("crud-machine-select").value;
        if (!confirm(`Are you sure you want to delete Machine ${id}?`)) return;
        
        if (isMock) {
          machines = machines.filter(x => x.machineId !== id);
        } else {
          await db.collection("machines").doc(id).delete();
        }
        await createAuditLog(currentUser?.email || "System", null, `Deleted Machine: ${id}`);
      }
    }
    
    else if (dmdSelectedEntity === 'material') {
      if (dmdSelectedAction === 'create') {
        const id = document.getElementById("crud-material-id").value.trim();
        const name = document.getElementById("crud-material-name").value.trim();
        const category = document.getElementById("crud-material-category").value.trim();
        const unit = document.getElementById("crud-material-unit").value;
        const dept = document.getElementById("crud-material-dept").value.trim();
        
        if (isMock) {
          materials.push({ id, name, type: category, category, unit, department: dept, isActive: true });
        } else {
          await db.collection("master_materials").doc(id).set({
            materialId: id, name, category, unit, department: dept, isActive: true
          });
        }
        await createAuditLog(currentUser?.email || "System", null, `Added Material: ${name}`);
        
      } else if (dmdSelectedAction === 'edit') {
        const id = document.getElementById("crud-material-select").value;
        const name = document.getElementById("crud-material-name").value.trim();
        const category = document.getElementById("crud-material-category").value.trim();
        const unit = document.getElementById("crud-material-unit").value;
        const dept = document.getElementById("crud-material-dept").value.trim();
        
        if (isMock) {
          const m = materials.find(x => x.materialId === id);
          if (m) {
            m.name = name; m.type = category; m.category = category; m.unit = unit; m.department = dept;
          }
        } else {
          await db.collection("master_materials").doc(id).update({
            name, category, unit, department: dept
          });
        }
        await createAuditLog(currentUser?.email || "System", null, `Updated Material: ${name}`);
        
      } else if (dmdSelectedAction === 'delete') {
        const id = document.getElementById("crud-material-select").value;
        if (!confirm(`Are you sure you want to delete Material ${id}?`)) return;
        
        if (isMock) {
          materials = materials.filter(x => x.materialId !== id);
        } else {
          await db.collection("master_materials").doc(id).delete();
        }
        await createAuditLog(currentUser?.email || "System", null, `Deleted Material: ${id}`);
      }
    }
    
    else if (dmdSelectedEntity === 'department') {
      if (dmdSelectedAction === 'create') {
        const name = document.getElementById("crud-dept-name").value.trim();
        const seq = Number(document.getElementById("crud-dept-seq").value);
        const locs = document.getElementById("crud-dept-locations").value.split(",").map(x => x.trim()).filter(Boolean);
        const reasons = document.getElementById("crud-dept-reasons").value.split(",").map(x => x.trim()).filter(Boolean);
        
        if (isMock) {
          window.departmentsList = window.departmentsList || [];
          window.departmentsList.push({ name, sequence: seq, allowedStoreLocations: locs, allowedPauseReasons: reasons });
        } else {
          await db.collection("departments").doc(name).set({
            name, sequence: seq, allowedStoreLocations: locs, allowedPauseReasons: reasons
          });
        }
        await createAuditLog(currentUser?.email || "System", null, `Created Department: ${name}`);
        
      } else if (dmdSelectedAction === 'edit') {
        const name = document.getElementById("crud-dept-select").value;
        const seq = Number(document.getElementById("crud-dept-seq").value);
        const locs = document.getElementById("crud-dept-locations").value.split(",").map(x => x.trim()).filter(Boolean);
        const reasons = document.getElementById("crud-dept-reasons").value.split(",").map(x => x.trim()).filter(Boolean);
        
        if (isMock) {
          const d = window.departmentsList.find(x => x.name === name);
          if (d) {
            d.sequence = seq; d.allowedStoreLocations = locs; d.allowedPauseReasons = reasons;
          }
        } else {
          await db.collection("departments").doc(name).update({
            sequence: seq, allowedStoreLocations: locs, allowedPauseReasons: reasons
          });
        }
        await createAuditLog(currentUser?.email || "System", null, `Updated Department: ${name}`);
        
      } else if (dmdSelectedAction === 'delete') {
        const name = document.getElementById("crud-dept-select").value;
        if (!confirm(`Are you sure you want to delete Department ${name}?`)) return;
        
        if (isMock) {
          window.departmentsList = window.departmentsList.filter(x => x.name !== name);
        } else {
          await db.collection("departments").doc(name).delete();
        }
        await createAuditLog(currentUser?.email || "System", null, `Deleted Department: ${name}`);
      }
    }
    
    alert("Operation completed successfully!");
    closeCrudModal();
    renderAll();
  } catch(err) {
    console.error(err);
    alert("Error performing operation: " + err.message);
  }
}

async function saveAndApproveUserDmd(uid) {
  const roleSelect = document.getElementById(`dmd-user-role-select-${uid}`);
  const deptSelect = document.getElementById(`dmd-user-dept-select-${uid}`);
  if (!roleSelect || !deptSelect) return;
  const role = roleSelect.value;
  const department = deptSelect.value;
  
  if (isMockMode()) {
    const mockUsers = MOCK_DB.getUsers();
    const u = mockUsers.find(x => x.uid === uid);
    if (u) {
      u.role = role;
      u.department = department;
      u.active = true;
      u.emailVerified = true;
      MOCK_DB.saveUsers(mockUsers);
    }
  } else {
    try {
      const db = firebase.firestore();
      await db.collection("users").doc(uid).update({
        role: role,
        department: department,
        active: true,
        emailVerified: true
      });
    } catch(err) {
      alert("Error saving: " + err.message);
      return;
    }
  }
  alert("User upgraded successfully!");
  createAuditLog(currentUser.email, null, `Approved & assigned role ${role.toUpperCase()} to user ID: ${uid}`);
  renderAll();
}

async function toggleUserStatusDmd(uid) {
  if (isMockMode()) {
    const mockUsers = MOCK_DB.getUsers();
    const u = mockUsers.find(x => x.uid === uid);
    if (u) {
      u.active = !u.active;
      MOCK_DB.saveUsers(mockUsers);
    }
  } else {
    try {
      const db = firebase.firestore();
      const doc = await db.collection("users").doc(uid).get();
      if (doc.exists) {
        const cur = doc.data().active || false;
        await db.collection("users").doc(uid).update({ active: !cur });
      }
    } catch(err) {
      alert("Error: " + err.message);
      return;
    }
  }
  renderAll();
}
