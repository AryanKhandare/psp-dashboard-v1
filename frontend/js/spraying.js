
function renderSprayingKpis() {
  const pending = jobs.filter(j => j.currentDepartment === "Spraying" && (!j.spraying || j.spraying.status === "Pending")).length;
  const running = jobs.filter(j => j.currentDepartment === "Spraying" && (j.spraying?.status === "In Progress" || j.spraying?.status === "Hold")).length;
  const completed = jobs.filter(j => j.spraying?.status === "Completed").length;

  const pEl = document.getElementById("spraying-kpis-pending");
  const rEl = document.getElementById("spraying-kpis-running");
  const cEl = document.getElementById("spraying-kpis-completed");
  const aEl = document.getElementById("spraying-kpis-avgtime");

  if (pEl) pEl.textContent = pending;
  if (rEl) rEl.textContent = running;
  if (cEl) cEl.textContent = completed;

  const completedSprayingJobs = jobs.filter(j => j.spraying?.status === "Completed");
  let avgCycleStr = "00:00:00";
  if (completedSprayingJobs.length > 0) {
    const totalDuration = completedSprayingJobs.reduce((sum, j) => sum + (j.spraying?.durationMs || 0), 0);
    const avgMs = totalDuration / completedSprayingJobs.length;
    avgCycleStr = formatDuration(avgMs);
  }
  if (aEl) aEl.textContent = avgCycleStr;
}

function renderSprayingLiveQueue() {
  const container = document.getElementById("spraying-queue-cards");
  if (!container) return;

  container.innerHTML = "";

  const filterKpVal = document.getElementById("spraying-filter-kp").value.trim().toLowerCase();
  const filterJcVal = document.getElementById("spraying-filter-jc") ? document.getElementById("spraying-filter-jc").value.trim().toLowerCase() : "";
  const filterCustVal = document.getElementById("spraying-filter-customer").value.trim().toLowerCase();

  const sprayingJobs = jobs.filter(j => {
    if (j.currentDepartment !== "Spraying" || j.spraying?.status === "Completed") return false;

    if (filterKpVal && !j.kpNumber.toLowerCase().includes(filterKpVal)) return false;
    if (filterJcVal && !getJobJcNo(j).toLowerCase().includes(filterJcVal)) return false;
    if (filterCustVal && !j.customer.toLowerCase().includes(filterCustVal)) return false;

    return true;
  });

  if (sprayingJobs.length === 0) {
    container.innerHTML = `<div class="no-selection-message" style="grid-column: 1 / -1; width: 100%;">No jobs match the queue filters.</div>`;
    return;
  }

  sprayingJobs.forEach(job => {
    const card = document.createElement("div");
    card.className = "stage-kanban-card";
    
    const urgency = getTATUrgency(job);
    if (urgency === "warning") {
      card.classList.add("job-card-tat-warning");
    } else if (urgency === "critical") {
      card.classList.add("job-card-tat-critical");
    }

    let statusClass = "badge-pending";
    let statusText = "Pending";
    if (job.spraying?.status === "In Progress") {
      statusClass = "badge-progress";
      statusText = "In Progress";
    } else if (job.spraying?.status === "Hold") {
      statusClass = "badge-hold";
      statusText = "Hold";
    }

    const cleanPriority = String(job.priority || "Normal").toLowerCase();

    let actionButton = "";
    if (!job.spraying || job.spraying.status === "Pending") {
      actionButton = `<button class="btn btn-success btn-xs" style="width: 100%; height: 32px;" onclick="openSprayingAssignModal('${job.kpNumber}')">START SPRAYING</button>`;
    } else {
      actionButton = `<button class="btn btn-primary btn-xs" style="width: 100%; height: 32px;" onclick="selectActiveSprayingJobAndSwitch('${job.kpNumber}')">VIEW STATION</button>`;
    }

    const kpClean = getCleanKpNumber(job.kpNumber);
    const jcNo = getJobJcNo(job);
    
    const splitRemarkHtml = job.splitRemark ? `
      <div class="job-card-row split-remark-row" style="margin-top: 4px; display: flex; flex-direction: column; align-items: flex-start;">
        <span class="job-card-label" style="color: #f97316 !important; font-size: 11px; font-weight: bold;">Split Remark:</span>
        <span class="job-card-value" style="color: #f97316 !important; font-size: 11px; white-space: normal; word-break: break-word;">${job.splitRemark}</span>
      </div>
    ` : "";

    const opDisplay = (job.spraying && job.spraying.operatorName) || job.assignedOperator || "";
    const assignedOpHtml = opDisplay ? `
      <div class="job-card-row">
        <span class="job-card-label">Operator:</span>
        <span class="job-card-value font-bold text-cyan">${opDisplay}</span>
      </div>
    ` : "";

    card.innerHTML = `
      <div class="stage-card-priority-strip ${cleanPriority}"></div>
      <div class="job-card-header" style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
        <span class="font-mono font-bold text-cyan" style="font-size: 14px;">${kpClean}${jcNo ? ` (${jcNo})` : ""}</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${buildTATChipHTML(job)}
          <span class="badge ${statusClass}" style="font-size: 10px; font-weight: 700;">${statusText}</span>
        </div>
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
          <span class="job-card-label">Process:</span>
          <span class="job-card-value text-cyan font-bold">${job.processType || "Plasma"}</span>
        </div>
        <div class="job-card-row">
          <span class="job-card-label">Quantity:</span>
          <span class="job-card-value font-mono">${renderQuantityWithHistory(job)}</span>
        </div>
        ${splitRemarkHtml}
        ${assignedOpHtml}
        <div class="job-card-row">
          <span class="job-card-label">Priority:</span>
          <span class="job-card-value font-bold text-cyan">${job.priority}</span>
        </div>
        ${buildCardArrivalTimerHTML(job)}
      </div>
      <div class="stage-card-actions" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px; display: flex; flex-direction: column; gap: 8px;">
        ${actionButton}
        ${buildDeleteJobButtonHTML(job.kpNumber)}
      </div>
    `;
    container.appendChild(card);
  });
}

function openSprayingAssignModal(kpNumber) {
  const modal = document.getElementById("modal-start-spraying");
  const kpDisplay = document.getElementById("modal-spraying-kp-display");

  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (!job) return;

  kpDisplay.textContent = kpNumber;
  modal.classList.add("active");

  const form = document.getElementById("spraying-start-form");
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);

  const currentQtyInput = newForm.querySelector("#spraying-start-qty-input");
  const currentBatchInput = newForm.querySelector("#spraying-start-batch-id");
  const currentLocationSelect = newForm.querySelector("#spraying-start-location-select");
  const currentBoothSelect = newForm.querySelector("#spraying-start-booth-select");
  const currentBoothGroup = newForm.querySelector("#spraying-start-booth-group");
  const currentOperatorSelect = newForm.querySelector("#spraying-start-operator-select");
  const currentOperatorCustomGroup = newForm.querySelector("#spraying-start-operator-custom-group");
  const currentOperatorCustomInput = newForm.querySelector("#spraying-start-operator-custom");
  const currentCancelBtn = newForm.querySelector("#btn-cancel-start-spraying");
  const currentSubmitBtn = newForm.querySelector("#btn-submit-start-spraying");

  // Initialize values on the cloned inputs
  currentQtyInput.value = job.quantity;
  currentQtyInput.max = job.quantity;
  currentBatchInput.value = "";
  
  // Set up operator list
  currentOperatorSelect.innerHTML = '<option value="" disabled selected>Select Operator</option>';
  const opsList = ["prism", "Suraj", "Amrish", "Duryodhan", "TJ", "Bhushan", "Avinash"];
  opsList.forEach(op => {
    const opt = document.createElement("option");
    opt.value = op;
    opt.textContent = op;
    currentOperatorSelect.appendChild(opt);
  });
  const optOther = document.createElement("option");
  optOther.value = "Other";
  optOther.textContent = "Other";
  currentOperatorSelect.appendChild(optOther);

  // Operator select change listener
  currentOperatorSelect.addEventListener("change", (e) => {
    if (e.target.value === "Other") {
      currentOperatorCustomGroup.style.display = "block";
      currentOperatorCustomInput.required = true;
    } else {
      currentOperatorCustomGroup.style.display = "none";
      currentOperatorCustomInput.required = false;
      currentOperatorCustomInput.value = "";
    }
  });

  // Location select change listener to populate booth dynamically
  currentLocationSelect.addEventListener("change", (e) => {
    const loc = e.target.value;
    currentBoothSelect.innerHTML = '<option value="" disabled selected>Select Booth</option>';
    
    // Find all occupied booths from jobs array
    const occupiedBooths = jobs
      .filter(j => j.currentDepartment === "Spraying" && (j.spraying?.status === "In Progress" || j.spraying?.status === "Hold"))
      .map(j => j.spraying?.sprayingBooth)
      .filter(Boolean);

    if (loc === "B-37") {
      currentBoothGroup.style.display = "block";
      currentBoothSelect.required = true;
      ["Booth 4", "Booth 5"].forEach(b => {
        const opt = document.createElement("option");
        opt.value = b;
        const occ = occupiedBooths.includes(b);
        if (occ) {
          opt.textContent = b + " (Occupied)";
          opt.disabled = true;
        } else {
          opt.textContent = b;
        }
        currentBoothSelect.appendChild(opt);
      });
    } else if (loc === "C-20/4") {
      currentBoothGroup.style.display = "block";
      currentBoothSelect.required = true;
      ["Booth 1", "Booth 2", "Booth 3"].forEach(b => {
        const opt = document.createElement("option");
        opt.value = b;
        const occ = occupiedBooths.includes(b);
        if (occ) {
          opt.textContent = b + " (Occupied)";
          opt.disabled = true;
        } else {
          opt.textContent = b;
        }
        currentBoothSelect.appendChild(opt);
      });
    } else {
      currentBoothGroup.style.display = "none";
      currentBoothSelect.required = false;
    }
  });

  currentLocationSelect.value = ""; // Force user to choose
  currentLocationSelect.required = true;

  if (currentSubmitBtn) {
    currentSubmitBtn.textContent = "Start Spraying Cycle";
  }
  currentBatchInput.required = true;

  if (currentCancelBtn) {
    currentCancelBtn.addEventListener("click", () => {
      modal.classList.remove("active");
    });
  }

  newForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const qty = Number(currentQtyInput.value);
    const batchId = currentBatchInput.value.trim();
    const loc = currentLocationSelect.value;
    
    // Resolve operator name
    const opSelectVal = currentOperatorSelect.value;
    let finalOpName = opSelectVal;
    if (opSelectVal === "Other") {
      finalOpName = currentOperatorCustomInput.value.trim();
    }
    const boothVal = currentBoothSelect.value;

    if (!finalOpName) {
      alert("Please select or enter Operator Name");
      return;
    }
    if (!boothVal) {
      alert("Please select Spraying Booth");
      return;
    }

    // Double check booth occupancy in case jobs array updated
    const occupiedBooths = jobs
      .filter(j => j.currentDepartment === "Spraying" && j.kpNumber !== job.kpNumber && (j.spraying?.status === "In Progress" || j.spraying?.status === "Hold"))
      .map(j => j.spraying?.sprayingBooth)
      .filter(Boolean);
    if (occupiedBooths.includes(boothVal)) {
      alert(`Booth "${boothVal}" is currently occupied by another job. Please select a vacant booth.`);
      return;
    }

    modal.classList.remove("active");
    await startSprayingCycle(job.kpNumber, finalOpName, batchId, qty, loc, boothVal);
  });
}

async function startSprayingCycle(kp, opName, batchId, qty, locationVal, boothVal) {
  const activeJob = jobs.find(j => j.currentDepartment === "Spraying" && j.spraying?.sprayingBooth === boothVal && (j.spraying?.status === "In Progress" || j.spraying?.status === "Hold"));
  if (activeJob) {
    alert(`Another Spraying cycle is already active in ${boothVal}!`);
    return;
  }
  
  const job = jobs.find(j => j.kpNumber === kp);
  if (!job) return;

  const nowStr = new Date().toISOString();
  
  job.status = "In Progress";
  job.shift = selectedShiftName || "A Shift";
  job.operatorName = opName;
  job.assignedOperator = opName;
  job.storeLocation = locationVal;
  job.spraying = job.spraying || {};
  job.spraying.status = "In Progress";
  job.spraying.batchId = batchId;
  job.spraying.processedQty = Number(qty);
  job.spraying.startTime = nowStr;
  job.spraying.lastStartedAt = nowStr;
  job.spraying.operatorName = opName;
  job.spraying.sprayingBooth = boothVal;
  job.spraying.location = locationVal;
  job.spraying.shift = selectedShiftName || "A Shift";
  job.spraying.holdHistory = [];
  job.spraying.activeTimeMs = 0;

  switchToSprayingSubtab("spraying-subtab-active");
  renderAll();

  const payload = {
    type: "START_CYCLE",
    kpNo: kp,
    stage: "Spraying",
    operatorName: opName,
    shift: selectedShiftName || "A Shift",
    startTime: nowStr,
    quantity: Number(qty),
    storeLocation: locationVal,
    sprayingBooth: boothVal,
    batchId: batchId,
    holdHistory: []
  };

  try {
    if (!isMockMode() && sendBackendPost) {
      await sendBackendPost(payload);
    }
    await createFirestoreAuditLog(opName, "Spraying", kp, "Cycle Started", `Commenced Spraying process (Batch ID: ${batchId}, Qty: ${qty})`);
    saveState();
    renderAll();
  } catch (err) {
    console.error("Failed to start spraying cycle:", err);
    alert("Error starting spraying cycle. Please try again.");
  }
}

async function completeSprayingDirectly(job, qty, locationVal) {
  const isSplit = qty < job.quantity;
  let payload = null;

  if (isSplit) {
    const stageData = {
      batchId: "",
      processedQty: qty,
      location: locationVal,
      durationMs: 0
    };
    payload = splitJobAndProgress(job, qty, "Grinding", "Spraying Operator", "Spraying", stageData);
  } else {
    job.spraying = job.spraying || {};
    job.spraying.status = "Completed";
    transitionToStage(job, "Grinding", "Spraying Operator");
    payload = {
      type: "END_CYCLE",
      kpNo: job.kpNumber,
      stage: "Spraying",
      nextStage: "Grinding",
      endTime: new Date().toISOString(),
      activeTimeMs: 0,
      processedQty: qty,
      location: locationVal
    };
  }

  try {
    if (!isMockMode() && sendBackendPost && payload) {
      await sendBackendPost(payload);
    }
    await createFirestoreAuditLog("Spraying Operator", "Spraying", job.kpNumber, "Location Updated", `Job routed directly to Grinding at location: ${locationVal}`);
    saveState();
    renderAll();
  } catch (err) {
    console.error("Direct spraying completion failed:", err);
    alert("Error saving location. Please try again.");
  }
}

function renderSprayingActiveJobTimer() {
  const noActiveMsg = document.getElementById("spraying-no-active-job-message");
  const activeInterface = document.getElementById("spraying-active-job-timer-interface");

  if (!noActiveMsg || !activeInterface) return;

  let activeJob = null;
  if (selectedSprayingJobKp) {
    activeJob = jobs.find(j => j.kpNumber === selectedSprayingJobKp && j.currentDepartment === "Spraying" && (j.spraying?.status === "In Progress" || j.spraying?.status === "Hold"));
  }
  if (!activeJob) {
    activeJob = jobs.find(j => j.currentDepartment === "Spraying" && (j.spraying?.status === "In Progress" || j.spraying?.status === "Hold"));
  }

  if (!activeJob) {
    noActiveMsg.style.display = "block";
    activeInterface.style.display = "none";
    selectedSprayingJobKp = null;
    window.sprayingJobActive = false;
    return;
  }

  selectedSprayingJobKp = activeJob.kpNumber;
  window.sprayingJobActive = (activeJob.spraying.status === "In Progress");

  noActiveMsg.style.display = "none";
  activeInterface.style.display = "block";

  document.getElementById("spraying-active-kp-no").textContent = getCleanKpNumber(activeJob.kpNumber);
  document.getElementById("spraying-active-part-name").textContent = activeJob.partName;
  document.getElementById("spraying-active-customer").textContent = activeJob.customer;
  const activeProcEl = document.getElementById("spraying-active-process-type");
  if (activeProcEl) activeProcEl.textContent = activeJob.processType || "Plasma";
  document.getElementById("spraying-active-qty").textContent = activeJob.spraying?.processedQty || activeJob.quantity;
  document.getElementById("spraying-active-batch-id").textContent = activeJob.spraying?.batchId || "-";
  document.getElementById("spraying-active-location").textContent = activeJob.storeLocation || "-";
  
  const boothEl = document.getElementById("spraying-active-booth");
  if (boothEl) boothEl.textContent = activeJob.spraying?.sprayingBooth || "-";
  
  const opEl = document.getElementById("spraying-active-operator");
  if (opEl) opEl.textContent = activeJob.spraying?.operatorName || activeJob.operatorName || "-";

  const btnPause = document.getElementById("btn-spraying-pause-cycle");
  const btnResume = document.getElementById("btn-spraying-resume-cycle");
  const btnEnd = document.getElementById("btn-spraying-end-cycle");
  const statusBadge = document.getElementById("spraying-active-cycle-status-badge");

  if (activeJob.spraying.status === "In Progress") {
    statusBadge.className = "badge badge-progress";
    statusBadge.textContent = "RUNNING";
    btnPause.style.display = "flex";
    btnResume.style.display = "none";
    btnEnd.style.display = "flex";
  } else if (activeJob.spraying.status === "Hold") {
    statusBadge.className = "badge badge-critical";
    statusBadge.textContent = "ON HOLD";
    btnPause.style.display = "none";
    btnResume.style.display = "flex";
    btnEnd.style.display = "flex";
  }

  updateSprayingTimerReadout(activeJob);
}

function updateSprayingTimerReadout(job) {
  const currentTimerDigits = document.getElementById("spraying-timer-readout");
  const startedSpan = document.getElementById("spraying-time-started");
  const pausedSpan = document.getElementById("spraying-time-paused-total");

  if (!currentTimerDigits) return;

  if (job.spraying?.status === "In Progress" && job.spraying?.lastStartedAt) {
    const elapsedMs = (job.spraying.activeTimeMs || 0) + (Date.now() - new Date(job.spraying.lastStartedAt).getTime());
    currentTimerDigits.textContent = formatDuration(elapsedMs);
  } else if (job.spraying?.status === "Hold") {
    currentTimerDigits.textContent = formatDuration(job.spraying.activeTimeMs || 0);
  } else {
    currentTimerDigits.textContent = "00:00:00";
  }

  startedSpan.textContent = job.spraying?.startTime ? new Date(job.spraying.startTime).toLocaleTimeString() : "--:--:--";
  
  let pausedMs = 0;
  const holds = job.spraying?.holdHistory || [];
  holds.forEach(h => {
    const pauseTime = new Date(h.pausedAt).getTime();
    const resumeTime = h.resumedAt ? new Date(h.resumedAt).getTime() : Date.now();
    pausedMs += (resumeTime - pauseTime);
  });
  pausedSpan.textContent = formatDuration(pausedMs);
}

function renderSprayingActiveCards() {
  renderSprayingActiveJobTimer();
}

function pauseSprayingCycle() {
  let activeJob = null;
  if (selectedSprayingJobKp) {
    activeJob = jobs.find(j => j.kpNumber === selectedSprayingJobKp && j.currentDepartment === "Spraying" && j.spraying?.status === "In Progress");
  }
  if (!activeJob) {
    activeJob = jobs.find(j => j.currentDepartment === "Spraying" && j.spraying?.status === "In Progress");
  }
  if (!activeJob) return;

  const modal = document.getElementById("modal-pause-spraying");
  const kpDisplay = document.getElementById("modal-pause-spraying-kp-display");
  kpDisplay.textContent = activeJob.kpNumber;

  modal.classList.add("active");

  const form = document.getElementById("spraying-pause-form");
  const reasonSelect = document.getElementById("spraying-pause-reason-select");
  const remarksInput = document.getElementById("spraying-pause-remarks");

  reasonSelect.value = "";
  remarksInput.value = "";

  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);

  newForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const reason = document.getElementById("spraying-pause-reason-select").value;
    const remarks = document.getElementById("spraying-pause-remarks").value;

    const nowStr = new Date().toISOString();
    const lastStarted = activeJob.spraying.lastStartedAt;
    const elapsedMs = lastStarted ? (Date.now() - new Date(lastStarted).getTime()) : 0;
    const currentActiveTime = (activeJob.spraying.activeTimeMs || 0) + elapsedMs;

    const holdEvent = {
      pausedAt: nowStr,
      resumedAt: null,
      reason: reason,
      remarks: remarks
    };

    const holdHistory = [...(activeJob.spraying.holdHistory || []), holdEvent];

    activeJob.status = "Hold";
    activeJob.spraying.status = "Hold";
    activeJob.spraying.lastPausedAt = nowStr;
    activeJob.spraying.activeTimeMs = currentActiveTime;
    activeJob.spraying.holdHistory = holdHistory;

    modal.classList.remove("active");
    renderAll();

    const payload = {
      type: "PAUSE_CYCLE",
      kpNo: activeJob.kpNumber,
      stage: "Spraying",
      operatorName: activeJob.operatorName,
      activeTimeMs: currentActiveTime,
      holdReason: reason,
      remarks: remarks,
      holdHistory: holdHistory
    };

    try {
      if (!isMockMode() && sendBackendPost) {
        await sendBackendPost(payload);
      }
      await createFirestoreAuditLog(activeJob.operatorName, "Spraying", activeJob.kpNumber, "Cycle Paused", `Paused Spraying cycle. Reason: ${reason}. Remarks: ${remarks}`);
      saveState();
      renderAll();
    } catch (err) {
      console.error("Failed to pause spraying cycle:", err);
      alert("Error pausing cycle.");
    }
  });
}

async function resumeSprayingCycle() {
  let activeJob = null;
  if (selectedSprayingJobKp) {
    activeJob = jobs.find(j => j.kpNumber === selectedSprayingJobKp && j.currentDepartment === "Spraying" && j.spraying?.status === "Hold");
  }
  if (!activeJob) {
    activeJob = jobs.find(j => j.currentDepartment === "Spraying" && j.spraying?.status === "Hold");
  }
  if (!activeJob) return;

  const nowStr = new Date().toISOString();
  const holdHistory = [...(activeJob.spraying.holdHistory || [])];
  if (holdHistory.length > 0) {
    holdHistory[holdHistory.length - 1].resumedAt = nowStr;
  }

  activeJob.status = "In Progress";
  activeJob.spraying.status = "In Progress";
  activeJob.spraying.lastStartedAt = nowStr;
  activeJob.spraying.holdHistory = holdHistory;

  renderAll();

  const payload = {
    type: "RESUME_CYCLE",
    kpNo: activeJob.kpNumber,
    stage: "Spraying",
    operatorName: activeJob.operatorName,
    holdHistory: holdHistory
  };

  try {
    if (!isMockMode() && sendBackendPost) {
      await sendBackendPost(payload);
    }
    await createFirestoreAuditLog(activeJob.operatorName, "Spraying", activeJob.kpNumber, "Cycle Resumed", "Job returned to active spraying state");
    saveState();
    renderAll();
  } catch (err) {
    console.error("Failed to resume spraying cycle:", err);
    alert("Error resuming cycle.");
  }
}

function endSprayingCycle() {
  let activeJob = null;
  if (selectedSprayingJobKp) {
    activeJob = jobs.find(j => j.kpNumber === selectedSprayingJobKp && j.currentDepartment === "Spraying" && (j.spraying?.status === "In Progress" || j.spraying?.status === "Hold"));
  }
  if (!activeJob) {
    activeJob = jobs.find(j => j.currentDepartment === "Spraying" && (j.spraying?.status === "In Progress" || j.spraying?.status === "Hold"));
  }
  if (!activeJob) return;

  const modal = document.getElementById("modal-complete-spraying");
  const kpDisplay = document.getElementById("modal-complete-spraying-kp-display");
  const qtyInput = document.getElementById("spraying-complete-qty");
  const nextSelect = document.getElementById("spraying-complete-next-process");
  const passesInput = document.getElementById("spraying-complete-passes");
  const tempInput = document.getElementById("spraying-complete-temp");
  const thicknessInput = document.getElementById("spraying-complete-thickness");
  const sizeInput = document.getElementById("spraying-complete-size");
  const powderInput = document.getElementById("spraying-complete-powder");
  const locationSelect = document.getElementById("spraying-complete-location");

  kpDisplay.textContent = activeJob.kpNumber;
  qtyInput.value = activeJob.spraying?.processedQty || activeJob.quantity;
  qtyInput.max = activeJob.spraying?.processedQty || activeJob.quantity;
  nextSelect.value = "Grinding";
  passesInput.value = "";
  tempInput.value = "";
  thicknessInput.value = "";
  sizeInput.value = "";
  powderInput.value = "";
  locationSelect.value = activeJob.storeLocation || "B-37";

  modal.classList.add("active");

  const form = document.getElementById("spraying-complete-form");
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);

  const currentQtyInput = document.getElementById("spraying-complete-qty");
  const currentNextSelect = document.getElementById("spraying-complete-next-process");
  const currentPassesInput = document.getElementById("spraying-complete-passes");
  const currentTempInput = document.getElementById("spraying-complete-temp");
  const currentThicknessInput = document.getElementById("spraying-complete-thickness");
  const currentSizeInput = document.getElementById("spraying-complete-size");
  const currentPowderInput = document.getElementById("spraying-complete-powder");
  const currentLocationSelect = document.getElementById("spraying-complete-location");

  newForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const doneQty = Number(currentQtyInput.value);
    const passes = Number(currentPassesInput.value);
    const temp = currentTempInput.value;
    const thickness = currentThicknessInput.value;
    const size = currentSizeInput.value;
    const powder = currentPowderInput.value;
    const locationVal = currentLocationSelect.value;

    const originalQty = activeJob.spraying?.processedQty || activeJob.quantity;
    if (doneQty > originalQty) {
      alert("Completed quantity cannot exceed running quantity!");
      return;
    }

    const elapsedMs = (activeJob.spraying.activeTimeMs || 0) + (activeJob.spraying.status === "In Progress" && activeJob.spraying.lastStartedAt ? (Date.now() - new Date(activeJob.spraying.lastStartedAt).getTime()) : 0);
    
    const stageData = {
      batchId: activeJob.spraying.batchId || "",
      processedQty: doneQty,
      totalPasses: passes,
      finalTemp: temp,
      finalThickness: thickness,
      finalSize: size,
      powderConsumed: powder,
      location: locationVal,
      durationMs: elapsedMs
    };

    const isSplit = doneQty < originalQty;

    const payloadGenerator = (nextStage) => {
      if (isSplit) {
        return splitJobAndProgress(activeJob, doneQty, nextStage, activeJob.operatorName, "Spraying", stageData);
      } else {
        return {
          type: "END_CYCLE",
          kpNo: activeJob.kpNumber,
          stage: "Spraying",
          nextStage: nextStage,
          endTime: new Date().toISOString(),
          activeTimeMs: elapsedMs,
          batchId: stageData.batchId,
          processedQty: doneQty,
          totalPasses: passes,
          finalTemp: temp,
          finalThickness: thickness,
          finalSize: size,
          powderConsumed: powder,
          location: locationVal,
          operatorName: activeJob.operatorName
        };
      }
    };

    const applyLocalMutation = (nextStage) => {
      if (!isSplit) {
        activeJob.spraying = activeJob.spraying || {};
        activeJob.spraying.status = "Completed";
        Object.assign(activeJob.spraying, stageData);
        transitionToStage(activeJob, nextStage, activeJob.operatorName);
      }
    };

    modal.classList.remove("active");
    selectedSprayingJobKp = null;

    showFloatingCardTransition(activeJob, "Spraying", payloadGenerator, applyLocalMutation);
  });
}

function renderSprayingHistory() {
  const tbody = document.getElementById("spraying-history-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  const completedJobs = jobs.filter(j => j.spraying?.status === "Completed");

  if (completedJobs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted">No completed jobs in Spraying.</td></tr>`;
    return;
  }

  completedJobs.forEach(job => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td class="font-mono font-bold text-cyan">${getCleanKpNumber(job.kpNumber)}${getJobJcNo(job) ? ` (${getJobJcNo(job)})` : ""}</td>
      <td>${job.partName}</td>
      <td>${job.customer}</td>
      <td class="font-mono">${job.spraying?.processedQty || job.quantity}</td>
      <td>${job.spraying?.batchId || "-"}</td>
      <td class="font-mono">${job.spraying?.totalPasses || "-"}</td>
      <td class="font-mono">${job.spraying?.finalTemp || "-"}</td>
      <td class="font-mono">${job.spraying?.finalThickness || "-"}</td>
      <td class="font-mono">${job.spraying?.finalSize || "-"}</td>
      <td class="font-mono">${job.spraying?.powderConsumed || "-"}</td>
      <td><span class="badge badge-completed">Completed</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function setupSprayingSubtabs() {
  const subtabButtons = document.querySelectorAll("#spraying-tabs-nav .grinding-tab-btn");

  subtabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetSubtab = btn.getAttribute("data-subtab");
      if (!targetSubtab) return;
      switchToSprayingSubtab(targetSubtab);
      renderSprayingDashboard();
    });
  });

  const filterKp = document.getElementById("spraying-filter-kp");
  if (filterKp) filterKp.addEventListener("input", renderSprayingLiveQueue);

  const filterJc = document.getElementById("spraying-filter-jc");
  if (filterJc) filterJc.addEventListener("input", renderSprayingLiveQueue);

  const filterCust = document.getElementById("spraying-filter-customer");
  if (filterCust) filterCust.addEventListener("input", renderSprayingLiveQueue);

  const clearFilters = document.getElementById("spraying-clear-filters");
  if (clearFilters) {
    clearFilters.addEventListener("click", () => {
      document.getElementById("spraying-filter-kp").value = "";
      if (document.getElementById("spraying-filter-jc")) document.getElementById("spraying-filter-jc").value = "";
      document.getElementById("spraying-filter-customer").value = "";
      renderSprayingLiveQueue();
    });
  }

  const btnPause = document.getElementById("btn-spraying-pause-cycle");
  if (btnPause) btnPause.addEventListener("click", pauseSprayingCycle);

  const btnResume = document.getElementById("btn-spraying-resume-cycle");
  if (btnResume) btnResume.addEventListener("click", resumeSprayingCycle);

  const btnEnd = document.getElementById("btn-spraying-end-cycle");
  if (btnEnd) btnEnd.addEventListener("click", endSprayingCycle);

  const closeStartModal = () => { document.getElementById("modal-start-spraying").classList.remove("active"); };
  document.getElementById("btn-close-start-spraying")?.addEventListener("click", closeStartModal);
  document.getElementById("btn-cancel-start-spraying")?.addEventListener("click", closeStartModal);

  const closeCompleteModal = () => { document.getElementById("modal-complete-spraying").classList.remove("active"); };
  document.getElementById("btn-close-complete-spraying")?.addEventListener("click", closeCompleteModal);
  document.getElementById("btn-cancel-complete-spraying")?.addEventListener("click", closeCompleteModal);

  const closePauseModal = () => { document.getElementById("modal-pause-spraying").classList.remove("active"); };
  document.getElementById("btn-close-pause-spraying")?.addEventListener("click", closePauseModal);
  document.getElementById("btn-cancel-pause-spraying")?.addEventListener("click", closePauseModal);

  window.openSprayingAssignModal = openSprayingAssignModal;
  window.selectActiveSprayingJobAndSwitch = selectActiveSprayingJobAndSwitch;
  window.switchToSprayingSubtab = switchToSprayingSubtab;
}

function switchToSprayingSubtab(subtabId) {
  activeSprayingSubtab = subtabId;
  const subtabButtons = document.querySelectorAll("#spraying-tabs-nav .grinding-tab-btn");
  const subtabPanels = [
    document.getElementById("spraying-subtab-queue"),
    document.getElementById("spraying-subtab-active"),
    document.getElementById("spraying-subtab-history")
  ];

  subtabButtons.forEach(btn => {
    if (btn.getAttribute("data-subtab") === subtabId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  subtabPanels.forEach(panel => {
    if (panel) {
      if (panel.id === subtabId) {
        panel.classList.add("active");
      } else {
        panel.classList.remove("active");
      }
    }
  });
}

function selectActiveSprayingJobAndSwitch(kp) {
  selectedSprayingJobKp = kp;
  switchToSprayingSubtab("spraying-subtab-active");
  renderAll();
}

// 11. TAB VIEW: AUDIT LOG VIEWER
function renderAuditLogs() {
  const tbody = document.getElementById("audit-logs-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (auditLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No logs recorded in audit logger.</td></tr>`;
    return;
  }

  auditLogs.forEach(log => {
    const tr = document.createElement("tr");
    const formattedTime = new Date(log.timestamp).toLocaleTimeString();
    
    let actionColorClass = "";
    if (log.action.includes("Completed")) actionColorClass = "text-green";
    else if (log.action.includes("Paused") || log.action.includes("Hold") || log.action.includes("Alert")) actionColorClass = "text-red";
    else if (log.action.includes("Started")) actionColorClass = "text-blue";

    // Format role for display
    const displayRole = (log.role || "System").replace('_', ' ').toUpperCase();

    tr.innerHTML = `
      <td class="text-muted font-mono" style="width: 120px;">${formattedTime}</td>
      <td><strong>${log.user}</strong></td>
      <td><span class="badge badge-normal" style="font-size:9px;">${displayRole}</span></td>
      <td>${log.department}</td>
      <td class="font-mono text-cyan">${log.kpNumber}</td>
      <td class="${actionColorClass}">${log.action}</td>
    `;
    tbody.appendChild(tr);
  });
}