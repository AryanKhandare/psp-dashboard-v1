
// Module 7: Supervisor Control Panel
function renderSupervisorPanel() {
  const waiting = jobs.filter(j => j.currentDepartment === "Masking" && j.masking?.status === "Pending").length;
  const progress = jobs.filter(j => j.currentDepartment === "Masking" && j.masking?.status === "In Progress").length;
  const completed = jobs.filter(j => j.masking?.status === "Completed").length;
  
  // Active operators count is number of operators assigned to current running jobs
  const runningJobs = jobs.filter(j => j.currentDepartment === "Masking" && j.masking?.status === "In Progress");
  const activeOpsSet = new Set(runningJobs.map(j => j.masking?.operatorName).filter(Boolean));
  const activeOpsCount = activeOpsSet.size;

  // Calculate Average Cycle Time of Completed Masking jobs
  const completedMaskingJobs = jobs.filter(j => j.masking?.status === "Completed");
  let avgCycleStr = "00:00:00";
  if (completedMaskingJobs.length > 0) {
    const totalDuration = completedMaskingJobs.reduce((sum, j) => sum + (j.masking?.durationMs || 0), 0);
    const avgMs = totalDuration / completedMaskingJobs.length;
    avgCycleStr = formatDuration(avgMs);
  }

  // Calculate Department Utilization: (Active Operators / Total Shift Capacity (e.g. 5)) * 100
  const totalOpsCapacity = operators.length || 5;
  const utilization = Math.round((activeOpsCount / totalOpsCapacity) * 100);

  document.getElementById("sup-kps-waiting").textContent = waiting;
  document.getElementById("sup-kps-progress").textContent = progress;
  document.getElementById("sup-kps-completed").textContent = completed;
  document.getElementById("sup-ops-active").textContent = activeOpsCount;
  document.getElementById("sup-avg-cycle").textContent = avgCycleStr;
  document.getElementById("sup-utilization").textContent = `${utilization}%`;
}


// Module 6: Daily Production Summary
function renderDailySummary() {
  // Filter jobs completed today
  const todayStr = new Date().toISOString().split('T')[0];
  const jobsCompletedToday = jobs.filter(j => {
    if (j.masking?.status !== "Completed" || !j.masking?.endTime) return false;
    const endDay = j.masking.endTime.split('T')[0];
    return endDay === todayStr;
  });

  const kpsProcessedToday = jobsCompletedToday.length;
  const partsProcessedToday = jobsCompletedToday.reduce((sum, j) => sum + j.quantity, 0);

  // Sum materials consumed by completed jobs today
  let totalMaterialKg = 0;
  jobsCompletedToday.forEach(j => {
    j.masking?.materials?.forEach(mat => {
      let qtyKg = parseFloat(mat.actualQty) || 0;
      if (mat.unit.toLowerCase() === "gram" || mat.unit.toLowerCase() === "g") {
        qtyKg = qtyKg / 1000; // Normalise to KG
      }
      totalMaterialKg += qtyKg;
    });
  });

  const pendingKpsLeft = jobs.filter(j => j.currentDepartment === "Masking" && j.masking?.status !== "Completed").length;


  document.getElementById("day-kps-processed").textContent = kpsProcessedToday;
  document.getElementById("day-parts-processed").textContent = partsProcessedToday;
  document.getElementById("day-material-consumed").textContent = `${totalMaterialKg.toFixed(2)} KG`;
  document.getElementById("day-jobs-pending").textContent = pendingKpsLeft;
  document.getElementById("day-jobs-completed").textContent = kpsProcessedToday;
  document.getElementById("day-shift-display").textContent = getLoggedUser().shift;
}

// Module 1: Live Job Queue
function renderLiveJobQueue() {
  const cardsContainer = document.getElementById("masking-queue-cards");
  if (!cardsContainer) return;
  cardsContainer.innerHTML = "";

  // Get active queue filters
  const filterKp = document.getElementById("filter-kp").value.toLowerCase();
  const filterJc = document.getElementById("filter-jc") ? document.getElementById("filter-jc").value.toLowerCase() : "";
  const filterCust = document.getElementById("filter-customer").value.toLowerCase();
  const filterProc = document.getElementById("filter-process").value;
  const filterStat = document.getElementById("filter-status").value;

  const queueJobs = jobs.filter(j => {
    // Only jobs currently in Masking, not yet Completed
    if (j.currentDepartment !== "Masking" || j.masking.status === "Completed") return false;
    
    // Apply filters
    if (filterKp && !j.kpNumber.toLowerCase().includes(filterKp)) return false;
    if (filterJc && !getJobJcNo(j).toLowerCase().includes(filterJc)) return false;
    if (filterCust && !j.customer.toLowerCase().includes(filterCust)) return false;
    if (filterProc && j.processType !== filterProc) return false;
    if (filterStat && j.masking.status !== filterStat) return false;
    
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
    if (job.masking.status === "In Progress") statusClass = "badge-progress";
    else if (job.masking.status === "Hold") statusClass = "badge-hold";

    const cleanPriority = String(job.priority || "Normal").toLowerCase();

    let actionButton = "";
    if (job.masking.status === "Pending") {
      actionButton = `
        <button class="btn btn-success btn-xs" style="width: 100%; height: 32px;" onclick="openAssignModal('${job.kpNumber}')">START MASKING</button>
        <button class="btn btn-secondary btn-xs" style="width: 100%; height: 32px;" onclick="openNoMaskingModal('${job.kpNumber}')">NO MASKING REQUIRED</button>
      `;
    } else {
      actionButton = `<button class="btn btn-primary btn-xs" style="width: 100%; height: 32px;" onclick="selectActiveJobAndSwitch('${job.kpNumber}')">VIEW STATION</button>`;
    }

    card.innerHTML = `
      <div class="stage-card-priority-strip ${cleanPriority}"></div>
      <div class="job-card-header" style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
        <span class="font-mono font-bold text-cyan" style="font-size: 14px;">${getCleanKpNumber(job.kpNumber)}${getJobJcNo(job) ? ` (${getJobJcNo(job)})` : ""}</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${buildTATChipHTML(job)}
          <span class="badge ${statusClass}" style="font-size: 10px; font-weight: 700;">${job.masking.status}</span>
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
        ${job.masking.operatorName ? `
        <div class="job-card-row">
          <span class="job-card-label">Operator:</span>
          <span class="job-card-value font-bold text-cyan">${job.masking.operatorName}</span>
        </div>
        ` : ''}
        <div class="job-card-row">
          <span class="job-card-label">Process Type:</span>
          <span class="job-card-value"><span class="badge badge-normal">${job.processType}</span></span>
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

function selectActiveJobAndSwitch(kpNumber) {
  selectActiveJob(kpNumber);
  switchToSubtab("masking-subtab-active");
}

// Module 2: Active Operation Panel (Digital Timer)
function renderActiveJobTimer() {
  const container = document.getElementById("active-job-timer-interface");
  const noJobMsg = document.getElementById("no-active-job-message");

  if (!selectedJobKp) {
    container.style.display = "none";
    noJobMsg.style.display = "flex";
    return;
  }

  const job = jobs.find(j => j.kpNumber === selectedJobKp);
  if (!job || job.currentDepartment !== "Masking" || job.masking.status === "Completed") {
    selectedJobKp = null;
    container.style.display = "none";
    noJobMsg.style.display = "flex";
    return;
  }

  // Populate active UI fields
  noJobMsg.style.display = "none";
  container.style.display = "flex";

  document.getElementById("active-kp-no").textContent = getCleanKpNumber(job.kpNumber) + (getJobJcNo(job) ? ` (${getJobJcNo(job)})` : "");
  document.getElementById("active-part-name").textContent = job.partName;
  document.getElementById("active-customer").textContent = job.customer;
  document.getElementById("active-qty").innerHTML = renderQuantityWithHistory(job);
  
  const processBadge = document.getElementById("active-process");
  processBadge.textContent = job.processType;
  
  document.getElementById("active-operator-display").textContent = job.masking.operatorName || "Unassigned";
  document.getElementById("active-shift-display").textContent = job.masking.shift || "Unassigned";

  // Cycle Status Badge Color Update
  const statusBadge = document.getElementById("active-cycle-status-badge");
  statusBadge.className = "badge";
  if (job.masking.status === "In Progress") {
    statusBadge.classList.add("badge-progress");
    statusBadge.textContent = "RUNNING";
  } else if (job.masking.status === "Hold") {
    statusBadge.classList.add("badge-hold");
    statusBadge.textContent = "ON HOLD";
  } else {
    statusBadge.classList.add("badge-normal");
    statusBadge.textContent = "STANDBY";
  }

  // Manage Action buttons layout based on status
  const btnStart = document.getElementById("btn-start-cycle");
  const btnPause = document.getElementById("btn-pause-cycle");
  const btnResume = document.getElementById("btn-resume-cycle");
  const btnEnd = document.getElementById("btn-end-cycle");

  if (job.masking.status === "Pending") {
    btnStart.style.display = "flex";
    btnPause.style.display = "none";
    btnResume.style.display = "none";
    btnEnd.style.display = "none";
  } else if (job.masking.status === "In Progress") {
    btnStart.style.display = "none";
    btnPause.style.display = "flex";
    btnResume.style.display = "none";
    btnEnd.style.display = "flex";
  } else if (job.masking.status === "Hold") {
    btnStart.style.display = "none";
    btnPause.style.display = "none";
    btnResume.style.display = "flex";
    btnEnd.style.display = "flex";
  }

  updateTimerReadout(job);
}

// Module 3: Active Job Cards
function renderActiveJobCards() {
  const container = document.getElementById("active-job-cards-container");
  container.innerHTML = "";

  const activeJobs = jobs.filter(j => j.currentDepartment === "Masking" && j.masking.status !== "Pending" && j.masking.status !== "Completed");

  if (activeJobs.length === 0) {
    container.innerHTML = `<div class="no-selection-message">No running masking cycles on the shop floor.</div>`;
    return;
  }

  activeJobs.forEach(job => {
    const card = document.createElement("div");
    card.className = "active-card";
    if (job.kpNumber === selectedJobKp) {
      card.classList.add("selected-card");
    }

    card.addEventListener("click", () => {
      selectActiveJob(job.kpNumber);
    });

    let statusBadgeClass = "badge-progress";
    if (job.masking.status === "Hold") statusBadgeClass = "badge-hold";

    // Dynamic timing calculation for card
    let runningMs = job.masking.activeTimeMs || 0;
    if (job.masking.status === "In Progress" && job.masking.lastStartedAt) {
      const start = new Date(job.masking.lastStartedAt).getTime();
      const now = new Date().getTime();
      runningMs += (now - start);
    }

    card.innerHTML = `
      <div class="card-left">
        <div class="card-kp-row">
          <span class="card-kp">${getCleanKpNumber(job.kpNumber)}${getJobJcNo(job) ? ` (${getJobJcNo(job)})` : ""}</span>
          <span class="badge ${statusBadgeClass} text-xs">${job.masking.status}</span>
        </div>
        <span class="card-part">${job.partName} (${renderQuantityWithHistory(job)})</span>
        <span class="card-op-info">Operator: ${job.masking.operatorName}</span>
      </div>
      <div class="card-right">
        <span class="card-time font-mono">${formatDuration(runningMs)}</span>
        <span class="text-xs text-muted">Active Run</span>
      </div>
    `;
    container.appendChild(card);
  });
}

// Timer sub-ticks runner
function startStateTimer() {
  if (timerIntervalId) clearInterval(timerIntervalId);
  
  timerIntervalId = setInterval(() => {
    // 1. Loop through all jobs to verify running ones and recalculate their running cards duration
    let isAnyJobRunning = false;
    jobs.forEach(job => {
      if (job.currentDepartment === "Masking" && job.masking.status === "In Progress") {
        isAnyJobRunning = true;
      }
      if (job.currentDepartment === "Grinding" && job.grinding?.status === "In Progress") {
        isAnyJobRunning = true;
      }
    });

    const activeTabPane = document.querySelector(".tab-pane.active");
    const activeTabId = activeTabPane ? activeTabPane.id : "";

    // 2. If selected masking job is running, refresh the main digital screen
    if (selectedJobKp && activeTabId === "tab-masking") {
      const activeJob = jobs.find(j => j.kpNumber === selectedJobKp);
      if (activeJob) {
        updateTimerReadout(activeJob);
        // Live update active operator stats if they are working
        updateOperatorLiveTimes();
      }
    }

    // 3. If selected grinding/spraying job is running, refresh their digital screens
    if (selectedGrindingJobKp && activeTabId === "tab-grinding") {
      const activeGrindingJob = jobs.find(j => j.kpNumber === selectedGrindingJobKp);
      if (activeGrindingJob) {
        updateGrindingTimerReadout(activeGrindingJob);
      }
    }
    if (selectedSprayingJobKp && activeTabId === "tab-spraying") {
      const activeSprayingJob = jobs.find(j => j.kpNumber === selectedSprayingJobKp);
      if (activeSprayingJob) {
        updateSprayingTimerReadout(activeSprayingJob);
      }
    }

    // 4. Keep running cards and panels updating
    if (activeTabId === "tab-masking") {
      renderActiveJobCards();
    }
    if (activeTabId === "tab-grinding" && typeof renderGrindingActiveCards === "function") {
      renderGrindingActiveCards();
    }
    if (activeTabId === "tab-spraying" && typeof renderSprayingActiveCards === "function") {
      renderSprayingActiveCards();
    }

    // Real-time card countdown timers update
    const jobTabs = ["tab-overview", "tab-inspection", "tab-masking", "tab-spraying", "tab-grinding", "tab-polishing", "tab-final-inspection", "tab-dispatch"];
    if (jobTabs.includes(activeTabId) && typeof updateCardCountdownTimers === "function") {
      updateCardCountdownTimers();
    }

    // Periodically run auto-assignment and forwarding checks every 10 seconds
    _forwardCheckTicks = (_forwardCheckTicks || 0) + 1;
    if (_forwardCheckTicks >= 10) {
      _forwardCheckTicks = 0;
      if (typeof checkAndAutoForwardJobs === "function") {
        checkAndAutoForwardJobs();
      }
      if (typeof autoAssignPendingJobs === "function") {
        autoAssignPendingJobs();
      }
    }

    // 5. OEE metrics background timer update
    const now = Date.now();
    const elapsedMs = now - oeeLastTickTime;
    const elapsedSec = Math.floor(elapsedMs / 1000);
    if (elapsedSec > 0) {
      oeeLastTickTime = now;
      ["Masking", "Spraying", "Grinding", "Polishing"].forEach(dept => {
        const state = loadOeeState(dept);
        const mode = getOeeCurrentMode(dept);
        
        if (mode === "NOWORK") state.noWork += elapsedSec;
        else if (mode === "IDLE") state.idle += elapsedSec;
        else if (mode === "ACTIVE") state.active += elapsedSec;
        
        saveOeeState(dept, state, false); // Save to in-memory cache only
        if (activeTabId === `tab-${dept.toLowerCase()}`) {
          updateOeeUi(dept, state, mode);
        }
      });
      
      // Persist cache to localStorage every 10 seconds to avoid disk thrashing
      window._oeeSaveTicks = (window._oeeSaveTicks || 0) + 1;
      if (window._oeeSaveTicks >= 10) {
        window._oeeSaveTicks = 0;
        persistOeeCacheToLocalStorage();
      }
    }
  }, 1000);
}

function updateTimerReadout(job) {
  const currentTimerDigits = document.getElementById("timer-cycle-current");
  const totalActiveDigits = document.getElementById("timer-total-active");

  if (!currentTimerDigits || !totalActiveDigits) return;

  let elapsedCurrent = 0;
  let totalActive = job.masking.activeTimeMs || 0;

  if (job.masking.status === "In Progress" && job.masking.lastStartedAt) {
    const start = new Date(job.masking.lastStartedAt).getTime();
    const now = new Date().getTime();
    elapsedCurrent = Math.max(0, now - start);
    totalActive += elapsedCurrent;
  }

  currentTimerDigits.textContent = formatDuration(elapsedCurrent);
  totalActiveDigits.textContent = formatDuration(totalActive);
}

function updateGrindingTimerReadout(job) {
  const currentTimerDigits = document.getElementById("grinding-timer-readout");
  const startedTimeDigits = document.getElementById("grinding-time-started");
  const pausedTimeDigits = document.getElementById("grinding-time-paused-total");

  if (!currentTimerDigits) return;

  let totalActive = job.grinding.activeTimeMs || 0;

  if (job.grinding.status === "In Progress" && job.grinding.lastStartedAt) {
    const start = new Date(job.grinding.lastStartedAt).getTime();
    const now = new Date().getTime();
    const elapsedCurrent = Math.max(0, now - start);
    totalActive += elapsedCurrent;
  }

  currentTimerDigits.textContent = formatDuration(totalActive);
  
  if (startedTimeDigits && job.grinding.startTime) {
    startedTimeDigits.textContent = new Date(job.grinding.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } else if (startedTimeDigits) {
    startedTimeDigits.textContent = "--:--:--";
  }

  if (pausedTimeDigits) {
    let pausedMs = 0;
    if (job.grinding.startTime) {
      const start = new Date(job.grinding.startTime).getTime();
      const end = job.grinding.endTime ? new Date(job.grinding.endTime).getTime() : new Date().getTime();
      pausedMs = Math.max(0, (end - start) - totalActive);
    }
    pausedTimeDigits.textContent = formatDuration(pausedMs);
  }
}

// Live increment operators active metrics on running jobs
function updateOperatorLiveTimes() {
  const activeJob = jobs.find(j => j.kpNumber === selectedJobKp);
  if (!activeJob || activeJob.masking.status !== "In Progress") return;

  const opName = String(activeJob.masking.operatorName || "").trim().toUpperCase();
  const op = operators.find(o => o.name && String(o.name).trim().toUpperCase() === opName);
  if (op) {
    // Increment active time by 1s (1000ms)
    op.activeTimeMs = (op.activeTimeMs || 0) + 1000;
    
    // Periodically save state (e.g. every 5 seconds to reduce storage cycles)
    const secondCount = Math.floor(Date.now() / 1000);
    if (secondCount % 5 === 0) {
      saveState();
      renderOperatorRegistry();
    }
  }
}

// Module 4: Material Consumption Tracking
function renderMaterialConsumption() {
  const interfaceDiv = document.getElementById("material-tracking-interface");
  const noJobDiv = document.getElementById("no-material-job-selected");

  if (!selectedJobKp) {
    interfaceDiv.style.display = "none";
    noJobDiv.style.display = "flex";
    return;
  }

  const job = jobs.find(j => j.kpNumber === selectedJobKp);
  if (!job || job.currentDepartment !== "Masking") {
    interfaceDiv.style.display = "none";
    noJobDiv.style.display = "flex";
    return;
  }

  noJobDiv.style.display = "none";
  interfaceDiv.style.display = "block";

  document.getElementById("mat-active-kp").textContent = job.kpNumber;

  // Render Material Selection Dropdown inside the consumer
  // Preserve the currently selected value across re-renders
  const matSelect = document.getElementById("mat-add-select");
  const previousSelectedMat = matSelect.value;
  matSelect.innerHTML = "";
  materials.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = `${m.name} (${m.type} - Batch: ${m.batch})`;
    matSelect.appendChild(opt);
  });
  // Restore previous selection if it still exists in the options
  if (previousSelectedMat) {
    const matchingOption = Array.from(matSelect.options).find(o => o.value === previousSelectedMat);
    if (matchingOption) matSelect.value = previousSelectedMat;
  }

  // Render Table Rows
  const tbody = document.getElementById("materials-tracking-rows");
  tbody.innerHTML = "";

  const jobMats = job.masking.materials || [];
  if (jobMats.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No materials assigned to this job. Add one below.</td></tr>`;
  } else {
    jobMats.forEach((mat, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="font-bold">${mat.name}</td>
        <td class="text-muted">${mat.type}</td>
        <td class="font-mono text-xs">${mat.batch}</td>
        <td class="font-mono">${mat.plannedQty}</td>
        <td>
          <div class="qty-adjust-container">
            <button type="button" class="btn-qty-adjust" onclick="adjustMaterialQty('${job.kpNumber}', ${idx}, -1)" ${job.masking.status === 'Completed' ? 'disabled' : ''}>-</button>
            <input type="number" step="0.01" min="0" 
              value="${mat.actualQty || 0}" 
              class="qty-adjust-input font-mono" 
              id="mat-actual-input-${idx}"
              onchange="updateJobMaterialActual('${job.kpNumber}', ${idx}, this.value)"
              ${job.masking.status === 'Completed' ? 'disabled' : ''}>
            <button type="button" class="btn-qty-adjust" onclick="adjustMaterialQty('${job.kpNumber}', ${idx}, 1)" ${job.masking.status === 'Completed' ? 'disabled' : ''}>+</button>
          </div>
        </td>
        <td><span class="badge badge-normal">${mat.unit}</span></td>
        <td>
          <button class="btn btn-danger btn-xs" 
            onclick="removeMaterialFromJob('${job.kpNumber}', ${idx})"
            ${job.masking.status === 'Completed' ? 'disabled' : ''} style="height: 60px; font-size: 16px;">Remove</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Calculate Materials Summary metrics
  calculateMaterialSummaries(job);
}

function adjustMaterialQty(kpNumber, index, dir) {
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (job && job.masking.materials[index]) {
    const mat = job.masking.materials[index];
    let step = 0.1;
    if (mat.unit.toLowerCase() === "gram" || mat.unit.toLowerCase() === "g" || mat.unit.toLowerCase() === "pc" || mat.unit.toLowerCase() === "pcs") {
      step = 10;
    }
    const currentVal = parseFloat(mat.actualQty) || 0;
    let newVal = currentVal + (dir * step);
    if (newVal < 0) newVal = 0;
    
    // Round to 2 decimals
    newVal = Math.round(newVal * 100) / 100;
    
    // Update local state immediately for instant UI feedback
    mat.actualQty = newVal;
    renderMaterialConsumption();
    
    // Then persist to backend in background
    updateJobMaterialActual(kpNumber, index, newVal);
  }
}

function calculateMaterialSummaries(job) {
  const jobMats = job.masking.materials || [];
  let totalKg = 0;
  let summaryParts = job.quantity || 1;

  jobMats.forEach(m => {
    let actualVal = parseFloat(m.actualQty) || 0;
    if (m.unit.toLowerCase() === "gram" || m.unit.toLowerCase() === "g") {
      actualVal = actualVal / 1000;
    }
    totalKg += actualVal;
  });

  const usagePerPart = totalKg / summaryParts;

  document.getElementById("calc-total-used").textContent = `${totalKg.toFixed(3)} KG`;
  document.getElementById("calc-usage-part").textContent = `${usagePerPart.toFixed(3)} KG/pc`;
}

async function updateJobMaterialActual(kpNumber, index, val) {
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (job && job.masking.materials[index]) {
    const floatVal = parseFloat(val);
    const mat = job.masking.materials[index];
    const actualQty = isNaN(floatVal) ? 0 : floatVal;

    // Update local state immediately so the UI stays responsive
    mat.actualQty = actualQty;
    calculateMaterialSummaries(job);
    renderMaterialConsumption();

    // Debounce backend sync requests to avoid lock timeout exceptions
    const timerKey = `${kpNumber}_${index}`;
    if (materialSyncTimers[timerKey]) {
      clearTimeout(materialSyncTimers[timerKey]);
    }

    materialSyncTimers[timerKey] = setTimeout(async () => {
      delete materialSyncTimers[timerKey];

      const payload = {
        type: "ADD_MATERIAL_CONSUMPTION",
        kpNo: kpNumber,
        stage: "Masking",
        materialName: mat.name,
        materialType: mat.type,
        batch: mat.batch,
        unit: mat.unit,
        plannedQty: mat.plannedQty,
        actualQty: actualQty,
        operatorName: getLoggedUser().name
      };

      try {
        await sendBackendPost(payload);
        console.log("Material qty synced to backend:", mat.name, actualQty);
      } catch (err) {
        console.error("Failed to sync material qty to backend:", err);
      }
    }, 1000); // 1-second debounce delay
  }
}

async function removeMaterialFromJob(kpNumber, index) {
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (job && job.masking.materials[index]) {
    const mat = job.masking.materials[index];
    const payload = {
      type: "DELETE_MATERIAL_CONSUMPTION",
      kpNo: kpNumber,
      stage: "Masking",
      materialName: mat.name,
      operatorName: getLoggedUser().name
    };

    // Optimistic UI mutation
    job.masking.materials.splice(index, 1);
    renderMaterialConsumption();
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
        console.error("Failed to sync material deletion:", err);
        if (pendingSyncCount === 0) {
          return loadState().then(() => renderAll());
        }
      });
  }
}

async function addMaterialToJob() {
  if (!selectedJobKp) return;
  const job = jobs.find(j => j.kpNumber === selectedJobKp);
  if (!job) return;

  const matName = document.getElementById("mat-add-select").value;
  const plannedQty = parseFloat(document.getElementById("mat-add-qty").value);

  if (isNaN(plannedQty) || plannedQty <= 0) {
    alert("Please enter a valid planned quantity.");
    return;
  }

  const baseMat = materials.find(m => m.name === matName);
  if (baseMat) {
    const payload = {
      type: "ADD_MATERIAL_CONSUMPTION",
      kpNo: selectedJobKp,
      stage: "Masking",
      materialName: baseMat.name,
      materialType: baseMat.type,
      batch: baseMat.batch,
      unit: baseMat.unit,
      plannedQty: plannedQty,
      actualQty: 0,
      operatorName: getLoggedUser().name
    };

    // Optimistic UI mutation
    const newMat = {
      name: baseMat.name,
      type: baseMat.type,
      batch: baseMat.batch,
      unit: baseMat.unit,
      plannedQty: plannedQty,
      actualQty: 0
    };
    job.masking.materials = job.masking.materials || [];
    job.masking.materials.push(newMat);

    document.getElementById("mat-add-qty").value = "";
    renderMaterialConsumption();
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
        console.error("Failed to sync material addition:", err);
        if (pendingSyncCount === 0) {
          return loadState().then(() => renderAll());
        }
      });
  }
}


// Module 9: Hold Management
function renderHoldManagementPanel() {
  const interfaceDiv = document.getElementById("hold-controls-interface");
  const noJobDiv = document.getElementById("no-hold-job-selected");

  if (!interfaceDiv || !noJobDiv) return;

  if (!selectedJobKp) {
    interfaceDiv.style.display = "none";
    noJobDiv.style.display = "flex";
    return;
  }

  const job = jobs.find(j => j.kpNumber === selectedJobKp);
  if (!job || job.currentDepartment !== "Masking") {
    interfaceDiv.style.display = "none";
    noJobDiv.style.display = "flex";
    return;
  }

  noJobDiv.style.display = "none";
  interfaceDiv.style.display = "block";

  const holdStatusLbl = document.getElementById("hold-status-lbl");
  holdStatusLbl.className = "badge";

  const triggerForm = document.getElementById("hold-trigger-form");
  const resumeSection = document.getElementById("hold-resume-section");
  const holdTimeLog = document.getElementById("hold-time-log");

  if (job.masking.status === "Hold") {
    holdStatusLbl.classList.add("badge-hold");
    holdStatusLbl.textContent = "PAUSED (HOLD)";
    triggerForm.style.display = "none";
    resumeSection.style.display = "block";

    // Show hold timestamps
    const lastHold = job.masking.holdHistory[job.masking.holdHistory.length - 1];
    if (lastHold) {
      holdTimeLog.innerHTML = `Job put on hold: ${new Date(lastHold.holdTime).toLocaleTimeString()}<br>Reason: ${lastHold.reason}`;
    }
  } else {
    holdStatusLbl.classList.add("badge-progress");
    holdStatusLbl.textContent = job.masking.status;
    triggerForm.style.display = "block";
    resumeSection.style.display = "none";
    holdTimeLog.textContent = "";

    // Set up reason button click listeners
    const reasonContainer = document.getElementById("hold-reason-buttons");
    if (reasonContainer) {
      reasonContainer.querySelectorAll(".touch-select-btn").forEach(btn => {
        const reasonVal = btn.getAttribute("data-reason");
        
        // highlight active state
        if (reasonVal === selectedHoldReason) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }

        btn.onclick = () => {
          reasonContainer.querySelectorAll(".touch-select-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          selectedHoldReason = reasonVal;
        };
      });
    }
  }
}

async function submitHoldJob() {
  if (!selectedJobKp) return;
  const job = jobs.find(j => j.kpNumber === selectedJobKp);
  if (!job || job.masking.status !== "In Progress") {
    alert("Job must be actively running in progress to place it on hold.");
    return;
  }

  if (!selectedHoldReason) {
    alert("Please select a hold reason by tapping one of the reason buttons first.");
    return;
  }

  const notesEl = document.getElementById("hold-notes");
  const notes = notesEl ? notesEl.value : "";
  const now = new Date();

  // 1. Calculate and store elapsed running duration up to this pause point
  let elapsed = 0;
  if (job.masking.lastStartedAt) {
    elapsed = now.getTime() - new Date(job.masking.lastStartedAt).getTime();
  }
  const finalActiveTimeMs = (job.masking.activeTimeMs || 0) + elapsed;

  // 2. Build Hold Record
  const newHoldRecord = {
    holdTime: now.toISOString(),
    resumeTime: null,
    reason: selectedHoldReason,
    notes: notes
  };
  const updatedHoldHistory = [...(job.masking.holdHistory || []), newHoldRecord];

  const payload = {
    type: "PAUSE_CYCLE",
    kpNo: selectedJobKp,
    stage: "Masking",
    operatorName: getLoggedUser().name,
    activeTimeMs: finalActiveTimeMs,
    holdHistory: updatedHoldHistory,
    holdReason: selectedHoldReason
  };

  // Optimistic UI mutation
  job.masking.status = "Hold";
  job.masking.activeTimeMs = finalActiveTimeMs;
  job.masking.lastPausedAt = now.toISOString();
  job.masking.holdHistory = updatedHoldHistory;

  // Clear selection
  selectedHoldReason = null;
  const reasonContainer = document.getElementById("hold-reason-buttons");
  if (reasonContainer) {
    reasonContainer.querySelectorAll(".touch-select-btn").forEach(b => b.classList.remove("active"));
  }
  if (notesEl) notesEl.value = "";

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
      console.error("Failed to sync hold action:", err);
      if (pendingSyncCount === 0) {
        return loadState().then(() => renderAll());
      }
    });
}

async function submitResumeJob() {
  if (!selectedJobKp) return;
  const job = jobs.find(j => j.kpNumber === selectedJobKp);
  if (!job || job.masking.status !== "Hold") return;

  const now = new Date();
  const updatedHoldHistory = [...(job.masking.holdHistory || [])];
  if (updatedHoldHistory.length > 0) {
    updatedHoldHistory[updatedHoldHistory.length - 1].resumeTime = now.toISOString();
  }

  const payload = {
    type: "RESUME_CYCLE",
    kpNo: selectedJobKp,
    stage: "Masking",
    operatorName: getLoggedUser().name,
    holdHistory: updatedHoldHistory
  };

  // Optimistic UI mutation
  job.masking.status = "In Progress";
  job.masking.lastStartedAt = now.toISOString();
  job.masking.holdHistory = updatedHoldHistory;

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
      console.error("Failed to sync resume action:", err);
      if (pendingSyncCount === 0) {
        return loadState().then(() => renderAll());
      }
    });
}


// Module 5: Cycle Tracking Chronology
function renderCycleChronology() {
  const displayDiv = document.getElementById("cycle-tracking-display");
  const noJobDiv = document.getElementById("no-cycle-job-selected");

  if (!selectedJobKp) {
    displayDiv.style.display = "none";
    noJobDiv.style.display = "flex";
    return;
  }

  const job = jobs.find(j => j.kpNumber === selectedJobKp);
  if (!job || job.currentDepartment !== "Masking") {
    displayDiv.style.display = "none";
    noJobDiv.style.display = "flex";
    return;
  }

  noJobDiv.style.display = "none";
  displayDiv.style.display = "block";

  document.getElementById("cycle-track-kp").textContent = job.kpNumber;

  const startT = job.masking.startTime ? new Date(job.masking.startTime).toLocaleTimeString() : "--:--:--";
  const endT = job.masking.endTime ? new Date(job.masking.endTime).toLocaleTimeString() : "UNDER OPERATION";
  
  document.getElementById("cycle-track-start").textContent = startT;
  document.getElementById("cycle-track-end").textContent = endT;

  // Duration
  let durationMs = job.masking.durationMs || 0;
  if (job.masking.status === "In Progress" && job.masking.lastStartedAt) {
    durationMs = (job.masking.activeTimeMs || 0) + (Date.now() - new Date(job.masking.lastStartedAt).getTime());
  } else if (job.masking.status === "Hold") {
    durationMs = job.masking.activeTimeMs || 0;
  }

  document.getElementById("cycle-track-duration").textContent = formatDuration(durationMs);

  // Render hold events
  const holdList = document.getElementById("cycle-track-hold-events");
  holdList.innerHTML = "";

  const history = job.masking.holdHistory || [];
  if (history.length === 0) {
    holdList.innerHTML = `<div class="text-muted">No hold interruptions logged.</div>`;
  } else {
    history.forEach(item => {
      const holdTimeStr = new Date(item.holdTime).toLocaleTimeString();
      const resumeTimeStr = item.resumeTime ? new Date(item.resumeTime).toLocaleTimeString() : "PENDING";
      
      const div = document.createElement("div");
      div.className = "hold-log-item";
      div.innerHTML = `
        <span><strong>${item.reason}</strong> (${item.notes || 'No remarks'})</span>
        <span>Hold: ${holdTimeStr} | Resume: ${resumeTimeStr}</span>
      `;
      holdList.appendChild(div);
    });
  }
}

// Module 10: Operator Management Registry
function renderOperatorRegistry() {
  const tbody = document.getElementById("operators-table-body");
  tbody.innerHTML = "";

  operators.forEach(op => {
    // Sum active hours
    const hours = (op.activeTimeMs / (1000 * 60 * 60)).toFixed(2);
    
    tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${op.name}</strong></td>
      <td class="font-mono">${op.shift}</td>
      <td class="font-mono text-center">${op.jobsAssigned}</td>
      <td class="font-mono text-center text-green">${op.jobsCompleted}</td>
      <td class="font-mono text-cyan">${hours} Hours</td>
    `;
    tbody.appendChild(tr);
  });
}

// Module 8: Job History Record
function renderJobHistory() {
  const tbody = document.getElementById("job-history-list");
  tbody.innerHTML = "";

  const histKp = document.getElementById("hist-filter-kp").value.toLowerCase();
  const histCust = document.getElementById("hist-filter-customer").value.toLowerCase();
  const histOp = document.getElementById("hist-filter-operator").value.toLowerCase();
  const histProc = document.getElementById("hist-filter-process").value;

  // History contains completed jobs or jobs that have progressed past masking
  const completedJobs = jobs.filter(j => {
    if (j.masking.status !== "Completed") return false;

    if (histKp && !j.kpNumber.toLowerCase().includes(histKp)) return false;
    if (histCust && !j.customer.toLowerCase().includes(histCust)) return false;
    if (histOp && !j.masking.operatorName.toLowerCase().includes(histOp)) return false;
    if (histProc && j.processType !== histProc) return false;

    return true;
  });

  if (completedJobs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted">No completed jobs found in the logs.</td></tr>`;
    return;
  }

  completedJobs.forEach(job => {
    const tr = document.createElement("tr");

    // Format start/end times
    const startStr = job.masking.startTime ? new Date(job.masking.startTime).toLocaleTimeString() : "--:--:--";
    const endStr = job.masking.endTime ? new Date(job.masking.endTime).toLocaleTimeString() : "--:--:--";
    const durStr = formatDuration(job.masking.durationMs);

    // Format material quantities
    const matStrings = job.masking.materials.map(m => `${m.name}: ${m.actualQty} ${m.unit}`);
    const matCell = matStrings.length > 0 ? matStrings.join("<br>") : "None";

    tr.innerHTML = `
      <td class="font-mono font-bold text-cyan">${job.kpNumber}${getJobJcNo(job) ? ` (${getJobJcNo(job)})` : ""}</td>
      <td>${job.partName}</td>
      <td>${job.customer}</td>
      <td class="font-mono">${job.quantity}</td>
      <td>${job.masking.operatorName}</td>
      <td class="font-mono">${job.masking.shift}</td>
      <td class="font-mono text-xs">${startStr}</td>
      <td class="font-mono text-xs">${endStr}</td>
      <td class="font-mono text-cyan">${durStr}</td>
      <td class="text-muted text-xs">${matCell}</td>
      <td><span class="badge badge-completed">Completed</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// 10. TAB VIEW: SPRAYING DASHBOARD (Integrated React console in iframe)
// 10. TAB VIEW: SPRAYING DASHBOARD
function renderSprayingDashboard() {
  renderSprayingKpis();
  
  if (activeSprayingSubtab === "spraying-subtab-queue") {
    renderSprayingLiveQueue();
  } else if (activeSprayingSubtab === "spraying-subtab-active") {
    renderSprayingActiveJobTimer();
  } else if (activeSprayingSubtab === "spraying-subtab-history") {
    renderSprayingHistory();
  }
}

// 12. ACTIVE OPERATION STATE TRANSITIONS & TIMER WORKFLOW ACTIONS
function openAssignModal(kpNumber) {
  const modal = document.getElementById("modal-assign-operator");
  const kpDisplay = document.getElementById("modal-kp-display");
  const opSelect = document.getElementById("modal-operator-select");
  
  kpDisplay.textContent = kpNumber;

  // Set default selection from header selects
  const logged = getLoggedUser();
  if (logged && logged.name && !logged.name.toLowerCase().includes("admin") && !logged.name.includes("@")) {
    selectedOperatorName = logged.name;
  } else {
    selectedOperatorName = "";
  }
  selectedShiftName = logged ? (logged.shift || "A Shift") : "A Shift";

  // Populate Operator Dropdown
  if (opSelect) {
    opSelect.innerHTML = "";
    
    // Default option
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "-- Select Operator --";
    opSelect.appendChild(defaultOpt);
    
    const presetNames = ["SJ", "DN", "Tripati", "GN", "Vikrant", "Sameer", "Dhuryodhan", "TJ"];
    presetNames.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name.toLowerCase() === (selectedOperatorName || "").toLowerCase()) {
        opt.selected = true;
        selectedOperatorName = name;
      }
      opSelect.appendChild(opt);
    });
    
    // Add Others option
    const otherOpt = document.createElement("option");
    otherOpt.value = "others";
    otherOpt.textContent = "Others...";
    if (selectedOperatorName && !presetNames.some(n => n.toLowerCase() === selectedOperatorName.toLowerCase())) {
      otherOpt.selected = true;
      otherOpt.textContent = `Others (${selectedOperatorName})`;
      otherOpt.value = selectedOperatorName;
    }
    opSelect.appendChild(otherOpt);
    
    opSelect.onchange = () => {
      const val = opSelect.value;
      if (val === "others") {
        const manualName = prompt("Please enter the operator name manually:");
        if (manualName && manualName.trim()) {
          const trimmed = manualName.trim();
          selectedOperatorName = trimmed;
          otherOpt.textContent = `Others (${trimmed})`;
          otherOpt.value = trimmed;
          otherOpt.selected = true;
        } else {
          opSelect.value = "";
          selectedOperatorName = "";
        }
      } else {
        selectedOperatorName = val;
      }
    };
  }

  // Shift Buttons highlights
  const shiftContainer = document.getElementById("modal-shift-buttons");
  if (shiftContainer) {
    shiftContainer.querySelectorAll(".touch-select-btn").forEach(btn => {
      const shiftVal = btn.getAttribute("data-shift");
      if (shiftVal === selectedShiftName) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
      
      btn.onclick = () => {
        shiftContainer.querySelectorAll(".touch-select-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedShiftName = shiftVal;
      };
    });
  }

  modal.classList.add("active");
}

function closeAssignModal() {
  document.getElementById("modal-assign-operator").classList.remove("active");
}

let selectedNoMaskingOperatorName = null;

function openNoMaskingModal(kpNumber) {
  const modal = document.getElementById("modal-no-masking-required");
  const kpDisplay = document.getElementById("modal-no-masking-kp-display");
  const opButtonsContainer = document.getElementById("modal-no-masking-operator-buttons");
  
  if (!modal || !kpDisplay || !opButtonsContainer) return;
  
  kpDisplay.textContent = kpNumber;
  
  // Set default selection
  const logged = getLoggedUser();
  if (logged && logged.name && !logged.name.toLowerCase().includes("admin") && !logged.name.includes("@")) {
    selectedNoMaskingOperatorName = logged.name;
  } else {
    selectedNoMaskingOperatorName = null;
  }
  
  // Render Operator Touch Buttons
  opButtonsContainer.innerHTML = "";
  const presetNames = ["SJ", "DN", "Tripati", "GN", "Vikrant", "Sameer", "Dhuryodhan", "TJ"];
  
  presetNames.forEach(name => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "touch-select-btn";
    if (name === selectedNoMaskingOperatorName) {
      btn.classList.add("active");
    }
    btn.textContent = name;
    btn.addEventListener("click", () => {
      opButtonsContainer.querySelectorAll(".touch-select-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedNoMaskingOperatorName = name;
    });
    opButtonsContainer.appendChild(btn);
  });

  // "Others" operator button
  const otherBtn = document.createElement("button");
  otherBtn.type = "button";
  otherBtn.className = "touch-select-btn";
  
  const isPresetActive = presetNames.includes(selectedNoMaskingOperatorName);
  if (selectedNoMaskingOperatorName && !isPresetActive) {
    otherBtn.classList.add("active");
    otherBtn.textContent = `Others (${selectedNoMaskingOperatorName})`;
  } else {
    otherBtn.textContent = "Others";
  }

  otherBtn.addEventListener("click", () => {
    const manualName = prompt("Please enter the operator name manually:");
    if (manualName && manualName.trim()) {
      const trimmed = manualName.trim();
      opButtonsContainer.querySelectorAll(".touch-select-btn").forEach(b => b.classList.remove("active"));
      otherBtn.classList.add("active");
      otherBtn.textContent = `Others (${trimmed})`;
      selectedNoMaskingOperatorName = trimmed;
    } else {
      if (!selectedNoMaskingOperatorName) {
        alert("Please select an operator or enter a name via 'Others'.");
      }
    }
  });
  opButtonsContainer.appendChild(otherBtn);
  
  document.getElementById("no-masking-reason").value = "";
  modal.classList.add("active");
}

function closeNoMaskingModal() {
  const modal = document.getElementById("modal-no-masking-required");
  if (modal) modal.classList.remove("active");
}

async function submitNoMasking(e) {
  if (e) e.preventDefault();
  const kpNo = document.getElementById("modal-no-masking-kp-display").textContent;
  const reason = document.getElementById("no-masking-reason").value;
  const nextDept = document.getElementById("no-masking-next-process").value || "Spraying";
  
  if (!selectedNoMaskingOperatorName) {
    alert("Please select an operator first.");
    return;
  }
  if (!reason || !reason.trim()) {
    alert("Please enter a reason.");
    return;
  }
  
  const job = jobs.find(j => j.kpNumber === kpNo);
  if (!job) return;
  
  // Optimistic UI mutation
  job.currentDepartment = nextDept;
  job.status = "Pending";
  job.masking = job.masking || {};
  job.masking.status = "No Masking Required";
  job.masking.operatorName = selectedNoMaskingOperatorName;
  job.masking.noMaskingReason = reason.trim();
  job.masking.noMasking = true;
  job.masking.endTime = new Date().toISOString();
  
  const nextStageKeyName = nextDept.toLowerCase().replace(/[^a-z]/g, "");
  job[nextStageKeyName] = job[nextStageKeyName] || {};
  job[nextStageKeyName].status = "Pending";
  
  closeNoMaskingModal();
  renderAll();
  
  const payload = {
    type: "BYPASS_MASKING",
    kpNo: kpNo,
    operatorName: selectedNoMaskingOperatorName,
    reason: reason.trim(),
    nextStage: nextDept
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
      console.error("Failed to bypass masking:", err);
      if (pendingSyncCount === 0) {
        return loadState().then(() => renderAll());
      }
    });
}

function selectActiveJob(kpNumber) {
  selectedJobKp = kpNumber;
  renderMaskingDashboard();
}

async function startMaskingCycle(kpNumber, opName, shiftName) {
  const now = new Date().toISOString();
  const payload = {
    type: "START_CYCLE",
    kpNo: kpNumber,
    stage: "Masking",
    operatorName: opName,
    shift: shiftName,
    startTime: now,
    holdHistory: []
  };

  // Optimistic UI mutation
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (job) {
    job.masking = job.masking || {};
    job.masking.status = "In Progress";
    job.masking.operatorName = opName;
    job.masking.shift = shiftName;
    job.masking.startTime = now;
    job.masking.lastStartedAt = now;
    job.masking.holdHistory = [];
    job.masking.activeTimeMs = 0;
  }

  selectedJobKp = kpNumber;
  closeAssignModal();
  switchToSubtab("masking-subtab-active");
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
      console.error("Failed to sync start cycle:", err);
      if (pendingSyncCount === 0) {
        return loadState().then(() => renderAll());
      }
    });
}

function pauseMaskingCycle() {
  if (!selectedJobKp) return;
  const job = jobs.find(j => j.kpNumber === selectedJobKp);
  if (!job || job.masking.status !== "In Progress") {
    alert("Job must be actively running in progress to place it on hold.");
    return;
  }
  
  const modal = document.getElementById("modal-pause-masking");
  if (modal) {
    document.getElementById("modal-pause-kp-display").textContent = job.kpNumber;
    document.getElementById("pause-reason-select").value = "";
    document.getElementById("pause-remarks").value = "";
    modal.classList.add("active");
  }
}

function closePauseMaskingModal() {
  const modal = document.getElementById("modal-pause-masking");
  if (modal) modal.classList.remove("active");
}

async function submitPauseMasking(e) {
  if (e) e.preventDefault();
  if (!selectedJobKp) return;
  const job = jobs.find(j => j.kpNumber === selectedJobKp);
  if (!job || job.masking.status !== "In Progress") return;

  const reason = document.getElementById("pause-reason-select").value;
  if (!reason) {
    alert("Please select a hold reason.");
    return;
  }

  const remarks = document.getElementById("pause-remarks").value;
  const now = new Date();

  // Calculate elapsed
  let elapsed = 0;
  if (job.masking.lastStartedAt) {
    elapsed = now.getTime() - new Date(job.masking.lastStartedAt).getTime();
  }
  const finalActiveTimeMs = (job.masking.activeTimeMs || 0) + elapsed;

  // Build Hold Record
  const newHoldRecord = {
    holdTime: now.toISOString(),
    resumeTime: null,
    reason: reason,
    notes: remarks
  };
  const updatedHoldHistory = [...(job.masking.holdHistory || []), newHoldRecord];

  const payload = {
    type: "PAUSE_CYCLE",
    kpNo: selectedJobKp,
    stage: "Masking",
    operatorName: getLoggedUser().name,
    activeTimeMs: finalActiveTimeMs,
    holdHistory: updatedHoldHistory,
    holdReason: reason
  };

  // Optimistic UI mutation
  job.masking.status = "Hold";
  job.masking.activeTimeMs = finalActiveTimeMs;
  job.masking.lastPausedAt = now.toISOString();
  job.masking.holdHistory = updatedHoldHistory;

  closePauseMaskingModal();
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
      console.error("Failed to sync hold action:", err);
      if (pendingSyncCount === 0) {
        return loadState().then(() => renderAll());
      }
    });
}

function resumeMaskingCycle() {
  submitResumeJob();
}

// Materials complete modal rendering & adjustments
function renderCompleteModalMaterials(job) {
  const container = document.getElementById("modal-complete-materials-container");
  if (!container) return;
  
  container.innerHTML = "";
  const jobMats = job.masking.materials || [];
  if (jobMats.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 10px;">No materials assigned to this job.</div>`;
    return;
  }
  
  jobMats.forEach((mat, idx) => {
    const div = document.createElement("div");
    div.style.marginBottom = "15px";
    div.style.borderBottom = "1px solid var(--border-color)";
    div.style.paddingBottom = "10px";
    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
        <span style="font-weight: bold; font-size: 14px;">${mat.name}</span>
        <span class="badge badge-normal" style="font-size: 11px;">${mat.unit}</span>
      </div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 5px;">
        Type: ${mat.type} | Batch: ${mat.batch} | Planned: ${mat.plannedQty}
      </div>
      <div style="display: flex; gap: 10px; align-items: center;">
        <label style="font-size: 13px;">Actual Used:</label>
        <div class="qty-adjust-container" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;">
          <button type="button" class="btn-qty-adjust" onclick="adjustCompleteModalMaterialQty(${idx}, -1)" style="height: 38px; width: 38px; font-size: 18px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-color); background: var(--bg-hover); color: var(--text-color); cursor: pointer; border-radius: 4px;">-</button>
          <input type="number" step="0.01" min="0" 
            value="${mat.actualQty || 0}" 
            class="qty-adjust-input font-mono" 
            id="modal-complete-mat-actual-input-${idx}"
            style="height: 38px; text-align: center; font-size: 16px; width: 80px; background: var(--bg-card); color: var(--text-color); border: 1px solid var(--border-color); border-radius: 4px;"
            onchange="updateCompleteModalMaterialQty(${idx}, this.value)">
          <button type="button" class="btn-qty-adjust" onclick="adjustCompleteModalMaterialQty(${idx}, 1)" style="height: 38px; width: 38px; font-size: 18px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-color); background: var(--bg-hover); color: var(--text-color); cursor: pointer; border-radius: 4px;">+</button>
        </div>
      </div>
    `;
    container.appendChild(div);
  });
}

window.adjustCompleteModalMaterialQty = function(index, dir) {
  if (!selectedJobKp) return;
  const job = jobs.find(j => j.kpNumber === selectedJobKp);
  if (!job) return;
  const mat = job.masking.materials[index];
  if (!mat) return;
  
  let step = 0.1;
  if (mat.unit.toLowerCase() === "gram" || mat.unit.toLowerCase() === "g" || mat.unit.toLowerCase() === "pc" || mat.unit.toLowerCase() === "pcs") {
    step = 10;
  }
  
  const currentVal = parseFloat(mat.actualQty) || 0;
  let newVal = currentVal + (dir * step);
  if (newVal < 0) newVal = 0;
  newVal = Math.round(newVal * 100) / 100;
  
  mat.actualQty = newVal;
  const input = document.getElementById(`modal-complete-mat-actual-input-${index}`);
  if (input) input.value = newVal;
  
  updateJobMaterialActual(selectedJobKp, index, newVal);
};

window.updateCompleteModalMaterialQty = function(index, val) {
  if (!selectedJobKp) return;
  const floatVal = parseFloat(val);
  const newVal = isNaN(floatVal) ? 0 : floatVal;
  updateJobMaterialActual(selectedJobKp, index, newVal);
};

// END MASKING CYCLE (OPENS COMPLETION MODAL)
function endMaskingCycle() {
  if (!selectedJobKp) return;
  const job = jobs.find(j => j.kpNumber === selectedJobKp);
  if (!job) return;

  // Open the Complete Masking Modal directly and render materials inputs inside
  const modal = document.getElementById("modal-complete-masking");
  document.getElementById("modal-complete-kp-display").textContent = job.kpNumber;
  
  // Set default next process from the static dropdown value or default to Spraying
  const staticSelect = document.getElementById("masking-next-process");
  const defaultNext = staticSelect ? staticSelect.value : "Spraying";
  document.getElementById("masking-complete-next-process").value = defaultNext;

  // Set quantity inputs for partial completion
  const qtyInput = document.getElementById("masking-complete-qty");
  if (qtyInput) {
    qtyInput.value = job.quantity;
    qtyInput.max = job.quantity;
  }

  renderCompleteModalMaterials(job);

  modal.classList.add("active");
}

function closeCompleteMaskingModal() {
  document.getElementById("modal-complete-masking").classList.remove("active");
}

async function submitCompleteMasking(e) {
  if (e) e.preventDefault();
  if (!selectedJobKp) return;
  const job = jobs.find(j => j.kpNumber === selectedJobKp);
  if (!job) return;

  // Validate entered quantity done in masking
  const doneQtyInput = document.getElementById("masking-complete-qty");
  const doneQty = doneQtyInput ? parseInt(doneQtyInput.value) : job.quantity;
  if (isNaN(doneQty) || doneQty <= 0 || doneQty > job.quantity) {
    alert("Please enter a valid quantity done (must be between 1 and " + job.quantity + ").");
    return;
  }

  // Confirm materials validation upon clicking submit inside the modal
  let missingActuals = false;
  job.masking.materials.forEach(mat => {
    if (mat.actualQty === 0 || mat.actualQty === "0" || isNaN(parseFloat(mat.actualQty))) {
      missingActuals = true;
    }
  });

  if (missingActuals) {
    if (!confirm("One or more material line items have actual quantity equal to zero. Do you want to submit anyway?")) {
      return;
    }
  }

  const now = new Date();
  
  // Calculate final elapsed runtime before stopping
  let finalActiveMs = job.masking.activeTimeMs || 0;
  if (job.masking.status === "In Progress" && job.masking.lastStartedAt) {
    finalActiveMs += (now.getTime() - new Date(job.masking.lastStartedAt).getTime());
  }

  const isSplit = doneQty < job.quantity;
  
  const payloadGenerator = (nextStage) => {
    if (isSplit) {
      return splitJobAndProgress(job, doneQty, nextStage, job.masking.operatorName || getLoggedUser().name, "Masking", {
        materials: job.masking.materials,
        durationMs: finalActiveMs,
        holdHistory: job.masking.holdHistory || []
      });
    } else {
      return {
        type: "END_CYCLE",
        kpNo: job.kpNumber,
        stage: "Masking",
        operatorName: job.masking.operatorName || getLoggedUser().name,
        endTime: now.toISOString(),
        activeTimeMs: finalActiveMs,
        nextStage: nextStage,
        holdHistory: job.masking.holdHistory || []
      };
    }
  };

  const applyLocalMutation = (nextStage) => {
    if (!isSplit) {
      job.masking.status = "Completed";
      job.masking.endTime = now.toISOString();
      job.masking.durationMs = finalActiveMs;
      transitionToStage(job, nextStage, job.masking.operatorName || getLoggedUser().name);
    }
  };

  selectedJobKp = null;
  closeCompleteMaskingModal();

  showFloatingCardTransition(job, "Masking", payloadGenerator, applyLocalMutation);
}


// ==================== STAGE DASHBOARDS & USER MANAGEMENT (NEW STAGES & CRUD) ====================

function setupGrindingSubtabs() {
  const subtabButtons = document.querySelectorAll(".grinding-tab-btn");
  const subtabPanels = document.querySelectorAll(".grinding-subtab-panel");

  subtabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetSubtab = btn.getAttribute("data-subtab");
      if (!targetSubtab) return;

      activeGrindingSubtab = targetSubtab;
      
      subtabButtons.forEach(b => b.classList.remove("active"));
      subtabPanels.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const targetPanel = document.getElementById(targetSubtab);
      if (targetPanel) targetPanel.classList.add("active");

      renderGrindingDashboard();
    });
  });
}

function switchToGrindingSubtab(subtabId) {
  activeGrindingSubtab = subtabId;
  const subtabButtons = document.querySelectorAll(".grinding-tab-btn");
  const subtabPanels = document.querySelectorAll(".grinding-subtab-panel");



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

function renderGrindingDashboard() {
  renderGrindingKpis();
  
  if (activeGrindingSubtab === "grinding-subtab-queue") {
    renderGrindingLiveQueue();
  } else if (activeGrindingSubtab === "grinding-subtab-active") {
    renderGrindingActiveJobTimer();
    renderGrindingActiveCards();
  } else if (activeGrindingSubtab === "grinding-subtab-history") {
    renderGrindingHistory();
  }
}