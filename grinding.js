
function renderGrindingKpis() {
  const pending = jobs.filter(j => j.currentDepartment === "Grinding" && j.grinding?.status === "Pending").length;
  const running = jobs.filter(j => j.currentDepartment === "Grinding" && j.grinding?.status === "In Progress").length;
  const completed = jobs.filter(j => j.grinding?.status === "Completed").length;
  
  const runningJobs = jobs.filter(j => j.currentDepartment === "Grinding" && j.grinding?.status === "In Progress");
  const machines = new Set(runningJobs.map(j => j.grinding?.machineName).filter(Boolean));
  
  const completedGrindingJobs = jobs.filter(j => j.grinding?.status === "Completed");
  let avgCycleStr = "00:00:00";
  if (completedGrindingJobs.length > 0) {
    const totalDuration = completedGrindingJobs.reduce((sum, j) => sum + (j.grinding?.durationMs || 0), 0);
    const avgMs = totalDuration / completedGrindingJobs.length;
    avgCycleStr = formatDuration(avgMs);
  }

  const pEl = document.getElementById("grinding-kpis-pending");
  const rEl = document.getElementById("grinding-kpis-running");
  const mEl = document.getElementById("grinding-kpis-machines");
  const cEl = document.getElementById("grinding-kpis-completed");
  const aEl = document.getElementById("grinding-kpis-avgtime");

  if (pEl) pEl.textContent = pending;
  if (rEl) rEl.textContent = running;
  if (mEl) mEl.textContent = machines.size;
  if (cEl) cEl.textContent = completed;
  if (aEl) aEl.textContent = avgCycleStr;
}

function renderGrindingLiveQueue() {
  const cardsContainer = document.getElementById("grinding-queue-cards");
  if (!cardsContainer) return;
  cardsContainer.innerHTML = "";

  const filterKp = document.getElementById("grinding-filter-kp").value.toLowerCase();
  const filterJc = document.getElementById("grinding-filter-jc") ? document.getElementById("grinding-filter-jc").value.toLowerCase() : "";
  const filterCust = document.getElementById("grinding-filter-customer").value.toLowerCase();
  const filterMach = document.getElementById("grinding-filter-machine").value;
  const filterProc = document.getElementById("grinding-filter-process").value;

  const queueJobs = jobs.filter(j => {
    if (j.currentDepartment !== "Grinding" || j.grinding?.status === "Completed") return false;
    
    if (filterKp && !j.kpNumber.toLowerCase().includes(filterKp)) return false;
    if (filterJc && !getJobJcNo(j).toLowerCase().includes(filterJc)) return false;
    if (filterCust && !j.customer.toLowerCase().includes(filterCust)) return false;
    if (filterMach && j.grinding?.machineName !== filterMach) return false;
    if (filterProc && j.grinding?.processType !== filterProc) return false;
    
    return true;
  });

  if (queueJobs.length === 0) {
    cardsContainer.innerHTML = `<div class="no-selection-message" style="grid-column: 1 / -1; width: 100%;">No jobs match the queue filters.</div>`;
    return;
  }

  queueJobs.forEach(job => {
    const card = document.createElement("div");
    card.className = "stage-kanban-card";
    
    const urgency = getTATUrgency(job);
    if (urgency === "warning") {
      card.classList.add("job-card-tat-warning");
    } else if (urgency === "critical") {
      card.classList.add("job-card-tat-critical");
    }
    
    let statusClass = "badge-pending";
    if (job.grinding.status === "In Progress") statusClass = "badge-progress";
    else if (job.grinding.status === "Hold") statusClass = "badge-hold";

    const cleanPriority = String(job.priority || "Normal").toLowerCase();

    let actionButton = "";
    if (job.grinding.status === "Pending") {
      actionButton = `<button class="btn btn-success btn-xs" style="width: 100%; height: 32px;" onclick="openStartGrindingModal('${job.kpNumber}')">START GRINDING</button>`;
    } else {
      actionButton = `<button class="btn btn-primary btn-xs" style="width: 100%; height: 32px;" onclick="selectActiveGrindingJobAndSwitch('${job.kpNumber}')">VIEW STATION</button>`;
    }

    card.innerHTML = `
      <div class="stage-card-priority-strip ${cleanPriority}"></div>
      <div class="job-card-header" style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
        <span class="font-mono font-bold text-cyan" style="font-size: 14px;">${getCleanKpNumber(job.kpNumber)}${getJobJcNo(job) ? ` (${getJobJcNo(job)})` : ""}</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${buildTATChipHTML(job)}
          <span class="badge ${statusClass}" style="font-size: 10px; font-weight: 700;">${job.grinding.status}</span>
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
          <span class="job-card-label">Quantity:</span>
          <span class="job-card-value font-mono">${renderQuantityWithHistory(job)}</span>
        </div>
        ${job.splitRemark ? `
        <div class="job-card-row split-remark-row" style="margin-top: 4px; display: flex; flex-direction: column; align-items: flex-start;">
          <span class="job-card-label" style="color: #f97316 !important; font-size: 11px; font-weight: bold;">Split Remark:</span>
          <span class="job-card-value" style="color: #f97316 !important; font-size: 11px; white-space: normal; word-break: break-word;">${job.splitRemark}</span>
        </div>
        ` : ''}
        ${job.grinding.operatorName ? `
        <div class="job-card-row">
          <span class="job-card-label">Operator:</span>
          <span class="job-card-value font-bold text-cyan">${job.grinding.operatorName}</span>
        </div>
        ` : ''}
        <div class="job-card-row">
          <span class="job-card-label">Machine:</span>
          <span class="job-card-value">${job.grinding.machineName || "Unassigned"}</span>
        </div>
        <div class="job-card-row">
          <span class="job-card-label">Process Stage:</span>
          <span class="job-card-value">${job.grinding.processType || "Unassigned"}</span>
        </div>
        <div class="job-card-row">
          <span class="job-card-label">Store Location:</span>
          <span class="job-card-value text-orange">${job.grinding.storeLocation || "N/A"}</span>
        </div>
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
    cardsContainer.appendChild(card);
  });
}

function selectActiveGrindingJobAndSwitch(kpNumber) {
  selectedGrindingJobKp = kpNumber;
  switchToGrindingSubtab("grinding-subtab-active");
  renderGrindingDashboard();
}

function renderGrindingActiveJobTimer() {
  const container = document.getElementById("grinding-active-job-timer-interface");
  const noJobMsg = document.getElementById("grinding-no-active-job-message");

  if (!selectedGrindingJobKp) {
    if (container) container.style.display = "none";
    if (noJobMsg) noJobMsg.style.display = "flex";
    return;
  }

  const job = jobs.find(j => j.kpNumber === selectedGrindingJobKp);
  if (!job || job.currentDepartment !== "Grinding" || job.grinding?.status === "Completed") {
    selectedGrindingJobKp = null;
    if (container) container.style.display = "none";
    if (noJobMsg) noJobMsg.style.display = "flex";
    return;
  }

  if (noJobMsg) noJobMsg.style.display = "none";
  if (container) container.style.display = "flex";

  document.getElementById("grinding-active-kp-no").textContent = getCleanKpNumber(job.kpNumber) + (getJobJcNo(job) ? ` (${getJobJcNo(job)})` : "");
  document.getElementById("grinding-active-part-name").textContent = job.partName;
  document.getElementById("grinding-active-customer").textContent = job.customer;
  document.getElementById("grinding-active-qty").innerHTML = renderQuantityWithHistory(job);
  document.getElementById("grinding-active-machine").textContent = job.grinding.machineName || "Unassigned";
  document.getElementById("grinding-active-process").textContent = job.grinding.processType || "Unassigned";
  document.getElementById("grinding-active-location").textContent = job.grinding.storeLocation || "N/A";

  const statusBadge = document.getElementById("grinding-active-cycle-status-badge");
  statusBadge.className = "badge";
  if (job.grinding.status === "In Progress") {
    statusBadge.classList.add("badge-progress");
    statusBadge.textContent = "RUNNING";
  } else if (job.grinding.status === "Hold") {
    statusBadge.classList.add("badge-hold");
    statusBadge.textContent = "ON HOLD";
  } else {
    statusBadge.classList.add("badge-normal");
    statusBadge.textContent = "STANDBY";
  }

  document.getElementById("grinding-operator-remarks").value = job.grinding.remarks || "";
  document.getElementById("grinding-quality-remarks").value = job.grinding.qualityRemarks || "";
  document.getElementById("grinding-notes").value = job.grinding.notes || "";

  const btnStart = document.getElementById("btn-grinding-start-cycle");
  const btnPause = document.getElementById("btn-grinding-pause-cycle");
  const btnResume = document.getElementById("btn-grinding-resume-cycle");
  const btnEnd = document.getElementById("btn-grinding-end-cycle");

  if (job.grinding.status === "Pending") {
    btnStart.style.display = "flex";
    btnPause.style.display = "none";
    btnResume.style.display = "none";
    btnEnd.style.display = "none";
  } else if (job.grinding.status === "In Progress") {
    btnStart.style.display = "none";
    btnPause.style.display = "flex";
    btnResume.style.display = "none";
    btnEnd.style.display = "flex";
  } else if (job.grinding.status === "Hold") {
    btnStart.style.display = "none";
    btnPause.style.display = "none";
    btnResume.style.display = "flex";
    btnEnd.style.display = "flex";
  }

  updateGrindingTimerReadout(job);
}

function renderGrindingActiveCards() {
  const container = document.getElementById("grinding-active-job-cards-container");
  if (!container) return;
  container.innerHTML = "";

  const activeJobs = jobs.filter(j => j.currentDepartment === "Grinding" && j.grinding?.status !== "Pending" && j.grinding?.status !== "Completed");

  if (activeJobs.length === 0) {
    container.innerHTML = `<div class="no-selection-message">No running grinding cycles on the shop floor.</div>`;
    return;
  }

  activeJobs.forEach(job => {
    const card = document.createElement("div");
    card.className = "active-card";
    if (job.kpNumber === selectedGrindingJobKp) {
      card.classList.add("selected-card");
    }

    card.addEventListener("click", () => {
      selectedGrindingJobKp = job.kpNumber;
      renderGrindingDashboard();
    });

    let statusBadgeClass = "badge-progress";
    if (job.grinding.status === "Hold") statusBadgeClass = "badge-hold";

    let runningMs = job.grinding.activeTimeMs || 0;
    if (job.grinding.status === "In Progress" && job.grinding.lastStartedAt) {
      const start = new Date(job.grinding.lastStartedAt).getTime();
      const now = new Date().getTime();
      runningMs += (now - start);
    }

    card.innerHTML = `
      <div class="card-left">
        <div class="card-kp-row">
          <span class="card-kp">${getCleanKpNumber(job.kpNumber)}${getJobJcNo(job) ? ` (${getJobJcNo(job)})` : ""}</span>
          <span class="badge ${statusBadgeClass} text-xs">${job.grinding.status}</span>
        </div>
        <span class="card-part">${job.partName} (${renderQuantityWithHistory(job)})</span>
        <span class="card-op-info">Machine: ${job.grinding.machineName}</span>
      </div>
      <div class="card-right">
        <span class="card-time font-mono">${formatDuration(runningMs)}</span>
        <span class="text-xs text-muted">Active Run</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderGrindingHistory() {
  const tbody = document.getElementById("grinding-history-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const filterKp = document.getElementById("grinding-hist-filter-kp").value.toLowerCase();
  const filterCust = document.getElementById("grinding-hist-filter-customer").value.toLowerCase();
  const filterMach = document.getElementById("grinding-hist-filter-machine").value.toLowerCase();
  const filterProc = document.getElementById("grinding-hist-filter-process").value;

  const historyJobs = jobs.filter(j => {
    if (j.grinding?.status !== "Completed") return false;
    
    if (filterKp && !j.kpNumber.toLowerCase().includes(filterKp)) return false;
    if (filterCust && !j.customer.toLowerCase().includes(filterCust)) return false;
    if (filterMach && !j.grinding.machineName.toLowerCase().includes(filterMach)) return false;
    if (filterProc && j.grinding.processType !== filterProc) return false;
    
    return true;
  });

  if (historyJobs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No completed grinding records.</td></tr>`;
    return;
  }

  historyJobs.forEach(job => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-mono font-bold text-cyan">${job.kpNumber}</td>
      <td>${job.partName}</td>
      <td>${job.customer}</td>
      <td class="font-mono">${job.grinding.quantity || job.quantity}</td>
      <td>${job.grinding.machineName}</td>
      <td>${job.grinding.processType}</td>
      <td>${job.grinding.storeLocation || "N/A"}</td>
      <td class="font-mono">${formatDuration(job.grinding.durationMs)}</td>
      <td><strong>${job.grinding.nextProcess || "Polishing"}</strong></td>
    `;
    tbody.appendChild(tr);
  });
}

function openStartGrindingModal(kpNumber) {
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (!job) return;

  document.getElementById("modal-grinding-kp-display").textContent = kpNumber;
  document.getElementById("grinding-machine-select").value = "";
  document.getElementById("grinding-process-select").value = "Pre Grinding";
  document.getElementById("grinding-qty-input").value = job.quantity;
  document.getElementById("grinding-location-select").value = "C20";

  document.getElementById("modal-start-grinding").classList.add("active");
}

function closeGrindingStartModal() {
  document.getElementById("modal-start-grinding").classList.remove("active");
}

function closeGrindingPauseModal() {
  document.getElementById("modal-pause-grinding").classList.remove("active");
}

function closeGrindingCompleteModal() {
  document.getElementById("modal-complete-grinding").classList.remove("active");
}

function submitStartGrinding(e) {
  e.preventDefault();
  const kp = document.getElementById("modal-grinding-kp-display").textContent;
  const machine = document.getElementById("grinding-machine-select").value;
  const process = document.getElementById("grinding-process-select").value;
  const qty = parseInt(document.getElementById("grinding-qty-input").value);
  const locationVal = document.getElementById("grinding-location-select").value;

  if (!machine) {
    alert("Machine selection is mandatory.");
    return;
  }

  startGrindingCycle(kp, machine, process, qty, locationVal);
}

function startGrindingCycle(kp, machine, process, qty, locationVal) {
  const job = jobs.find(j => j.kpNumber === kp);
  if (job) {
    const now = new Date();
    
    job.grinding.status = "In Progress";
    job.grinding.machineName = machine;
    job.grinding.processType = process;
    job.grinding.quantity = qty;
    job.grinding.storeLocation = locationVal;
    job.grinding.startTime = now.toISOString();
    job.grinding.lastStartedAt = now.toISOString();
    job.grinding.operatorName = currentUser?.email || "Operator";
    
    selectedGrindingJobKp = kp;
    closeGrindingStartModal();
    switchToGrindingSubtab("grinding-subtab-active");
    renderAll();

    createAuditLog(currentUser.email, kp, `Started Grinding cycle for ${kp} using Machine ${machine} (${process}) at ${locationVal}`);

    const payload = {
      type: "START_CYCLE",
      kpNo: kp,
      stage: "Grinding",
      operatorName: currentUser.email,
      startTime: now.toISOString(),
      machineName: machine,
      processType: process,
      quantity: qty,
      storeLocation: locationVal
    };

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
        console.error("Failed to sync grinding cycle start:", err);
      });
  }
}

function pauseGrindingCycle() {
  if (!selectedGrindingJobKp) return;
  document.getElementById("modal-pause-grinding-kp-display").textContent = selectedGrindingJobKp;
  document.getElementById("grinding-pause-reason-select").value = "";
  document.getElementById("grinding-pause-remarks").value = "";
  document.getElementById("modal-pause-grinding").classList.add("active");
}

function submitPauseGrinding(e) {
  e.preventDefault();
  const kp = selectedGrindingJobKp;
  const reason = document.getElementById("grinding-pause-reason-select").value;
  const remarks = document.getElementById("grinding-pause-remarks").value;

  if (!reason) {
    alert("Please select a hold reason.");
    return;
  }

  const job = jobs.find(j => j.kpNumber === kp);
  if (job && job.grinding.status === "In Progress") {
    const now = new Date();
    
    let activeMs = job.grinding.activeTimeMs || 0;
    if (job.grinding.lastStartedAt) {
      activeMs += (now.getTime() - new Date(job.grinding.lastStartedAt).getTime());
    }
    
    job.grinding.status = "Hold";
    job.grinding.activeTimeMs = activeMs;
    job.grinding.lastPausedAt = now.toISOString();
    job.grinding.lastStartedAt = null;
    
    const holdInst = {
      holdTime: now.toISOString(),
      resumeTime: null,
      reason: reason,
      remarks: remarks
    };
    job.grinding.holdHistory = job.grinding.holdHistory || [];
    job.grinding.holdHistory.push(holdInst);

    closeGrindingPauseModal();
    renderAll();

    createAuditLog(currentUser.email, kp, `Paused Grinding cycle. Reason: ${reason}. Remarks: ${remarks}`);

    const payload = {
      type: "PAUSE_CYCLE",
      kpNo: kp,
      stage: "Grinding",
      operatorName: currentUser.email,
      pauseTime: now.toISOString(),
      reason: reason,
      remarks: remarks,
      activeTimeMs: activeMs
    };

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
        console.error("Failed to sync grinding pause cycle:", err);
      });
  }
}

function resumeGrindingCycle() {
  if (!selectedGrindingJobKp) return;
  const kp = selectedGrindingJobKp;
  const job = jobs.find(j => j.kpNumber === kp);
  if (job && job.grinding.status === "Hold") {
    const now = new Date();
    
    job.grinding.status = "In Progress";
    job.grinding.lastStartedAt = now.toISOString();
    
    if (job.grinding.holdHistory && job.grinding.holdHistory.length > 0) {
      const lastHold = job.grinding.holdHistory[job.grinding.holdHistory.length - 1];
      lastHold.resumeTime = now.toISOString();
    }

    renderAll();

    createAuditLog(currentUser.email, kp, `Resumed Grinding cycle`);

    const payload = {
      type: "RESUME_CYCLE",
      kpNo: kp,
      stage: "Grinding",
      operatorName: currentUser.email,
      resumeTime: now.toISOString()
    };

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
        console.error("Failed to sync grinding resume cycle:", err);
      });
  }
}

function endGrindingCycle() {
  if (!selectedGrindingJobKp) return;
  const job = jobs.find(j => j.kpNumber === selectedGrindingJobKp);
  if (!job) return;

  document.getElementById("modal-complete-grinding-kp-display").textContent = getCleanKpNumber(selectedGrindingJobKp);
  document.getElementById("grinding-complete-next-process").value = "Polishing";
  
  const qtyInput = document.getElementById("grinding-complete-qty");
  if (qtyInput) {
    qtyInput.value = job.quantity;
    qtyInput.max = job.quantity;
  }
  
  document.getElementById("modal-complete-grinding").classList.add("active");
}

function submitCompleteGrinding(e) {
  e.preventDefault();
  const kp = selectedGrindingJobKp;

  const job = jobs.find(j => j.kpNumber === kp);
  if (job) {
    const now = new Date();
    
    // Validate quantity done in grinding
    const doneQtyInput = document.getElementById("grinding-complete-qty");
    const doneQty = doneQtyInput ? parseInt(doneQtyInput.value) : job.quantity;
    if (isNaN(doneQty) || doneQty <= 0 || doneQty > job.quantity) {
      alert("Please enter a valid quantity done (must be between 1 and " + job.quantity + ").");
      return;
    }

    job.grinding.remarks = document.getElementById("grinding-operator-remarks").value;
    job.grinding.qualityRemarks = document.getElementById("grinding-quality-remarks").value;
    job.grinding.notes = document.getElementById("grinding-notes").value;
    
    let activeMs = job.grinding.activeTimeMs || 0;
    if (job.grinding.status === "In Progress" && job.grinding.lastStartedAt) {
      activeMs += (now.getTime() - new Date(job.grinding.lastStartedAt).getTime());
    }

    const isSplit = doneQty < job.quantity;

    const payloadGenerator = (nextStage) => {
      if (isSplit) {
        return splitJobAndProgress(job, doneQty, nextStage, currentUser.email, "Grinding", {
          remarks: job.grinding.remarks,
          qualityRemarks: job.grinding.qualityRemarks,
          notes: job.grinding.notes,
          durationMs: activeMs
        });
      } else {
        return {
          type: "END_CYCLE",
          kpNo: kp,
          stage: "Grinding",
          operatorName: currentUser.email,
          endTime: now.toISOString(),
          activeTimeMs: activeMs,
          nextStage: nextStage,
          remarks: job.grinding.remarks,
          qualityRemarks: job.grinding.qualityRemarks,
          notes: job.grinding.notes
        };
      }
    };

    const applyLocalMutation = (nextStage) => {
      if (!isSplit) {
        job.grinding.status = "Completed";
        job.grinding.endTime = now.toISOString();
        job.grinding.durationMs = activeMs;
        job.grinding.nextProcess = nextStage;
        transitionToStage(job, nextStage, currentUser.email);
      }
    };

    selectedGrindingJobKp = null;
    closeGrindingCompleteModal();

    showFloatingCardTransition(job, "Grinding", payloadGenerator, applyLocalMutation);
  }
}

// Expose grinding functions to window context
window.openStartGrindingModal = openStartGrindingModal;
window.selectActiveGrindingJobAndSwitch = selectActiveGrindingJobAndSwitch;

function triggerPolishingFloatingTransition(kpNumber) {
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (!job) return;

  const doneQtyStr = prompt(`Enter quantity completed for Polishing (out of ${job.quantity}):`, job.quantity);
  if (doneQtyStr === null) return; // Cancelled
  const doneQty = parseInt(doneQtyStr);
  if (isNaN(doneQty) || doneQty <= 0 || doneQty > job.quantity) {
    alert(`Please enter a valid quantity done (must be between 1 and ${job.quantity}).`);
    return;
  }

  const payloadGenerator = (nextStage) => {
    const isSplit = doneQty < job.quantity;
    if (isSplit) {
      return splitJobAndProgress(job, doneQty, nextStage, getLoggedUser().name, "Polishing");
    } else {
      return {
        type: "END_CYCLE",
        kpNo: job.kpNumber,
        stage: "Polishing",
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

  showFloatingCardTransition(job, "Polishing", payloadGenerator, applyLocalMutation);
}

function renderPolishingDashboard() {
  const container = document.getElementById("polishing-queue-cards");
  if (!container) return;
  container.innerHTML = "";
  
  const polishingJobs = jobs.filter(j => {
    if (j.currentDepartment !== "Polishing") return false;
    return true;
  });

  if (polishingJobs.length === 0) {
    container.innerHTML = `<div class="no-selection-message" style="grid-column: 1 / -1; width: 100%;">No components in polishing stage.</div>`;
    return;
  }
  
  const isReadOnly = (currentUser && currentUser.role === 'hr_admin');
  
  polishingJobs.forEach(job => {
    const cleanJc = getJobJcNo(job);
    const priorityClass = String(job.priority || "Normal").toLowerCase();
    const card = document.createElement("div");
    card.className = "stage-kanban-card";
    card.draggable = !isReadOnly;
    
    const urgency = getTATUrgency(job);
    if (urgency === "warning") {
      card.classList.add("job-card-tat-warning");
    } else if (urgency === "critical") {
      card.classList.add("job-card-tat-critical");
    }
    
    if (!isReadOnly) {
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", job.kpNumber);
        card.classList.add("dragging");
        triggerPolishingFloatingTransition(job.kpNumber);
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
      });
    }

    card.innerHTML = `
      <div class="stage-card-priority-strip ${priorityClass}"></div>
      <div class="job-card-header" style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
        <span class="font-mono font-bold text-cyan" style="font-size: 14px;">${getCleanKpNumber(job.kpNumber)}${cleanJc ? ` (${cleanJc})` : ""}</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${buildTATChipHTML(job)}
          <span class="badge badge-normal" style="font-size: 10px; font-weight: 700;">${job.processType}</span>
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
          <span class="job-card-label">Quantity:</span>
          <span class="job-card-value font-mono">${renderQuantityWithHistory(job, true)}</span>
        </div>
        <div class="job-card-row">
          <span class="job-card-label">Status:</span>
          <span class="job-card-value"><span class="badge badge-pending">Polishing Pending</span></span>
        </div>
        ${(job.polishing && job.polishing.operatorName) ? `
        <div class="job-card-row">
          <span class="job-card-label">Operator:</span>
          <span class="job-card-value font-bold text-cyan">${job.polishing.operatorName}</span>
        </div>
        ` : ''}
        ${buildCardArrivalTimerHTML(job)}
      </div>
      <div class="stage-card-actions" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px; display: flex; flex-direction: column; gap: 8px;">
        <button class="btn btn-success btn-xs" style="width:100%; height:32px; ${isReadOnly ? 'display:none;' : ''}" onclick="triggerPolishingFloatingTransition('${job.kpNumber}')">Complete & Push Job</button>
        ${buildDeleteJobButtonHTML(job.kpNumber)}
      </div>
    `;
    container.appendChild(card);
  });
}