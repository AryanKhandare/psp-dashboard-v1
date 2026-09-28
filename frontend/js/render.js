
function getOeeCurrentMode(dept) {
  const deptJobs = jobs.filter(j => j.currentDepartment === dept);
  if (deptJobs.length === 0) return "NOWORK";
  
  if (dept === "Masking") {
    const activeJob = jobs.find(j => j.currentDepartment === "Masking" && j.masking.status === "In Progress");
    return activeJob ? "ACTIVE" : "IDLE";
  }
  if (dept === "Spraying") {
    const activeJob = jobs.find(j => j.currentDepartment === "Spraying" && j.spraying?.status === "In Progress");
    return activeJob ? "ACTIVE" : "IDLE";
  }
  if (dept === "Grinding") {
    const activeJob = jobs.find(j => j.currentDepartment === "Grinding" && j.grinding?.status === "In Progress");
    return activeJob ? "ACTIVE" : "IDLE";
  }
  if (dept === "Polishing") {
    return "IDLE";
  }
  return "NOWORK";
}

function renderAll() {
  if (_renderAllTimeout) return;
  _renderAllTimeout = setTimeout(() => {
    _renderAllTimeout = null;
    executeRenderAll();
  }, 50); // Coalesce rendering updates within 50ms
}

function executeRenderAll() {
  applyControlRestrictions();
  checkTATAlerts();
  
  // Update sidebar count indicators
  updateSidebarCounts();

  // Update header online/offline fallback status indicator
  updateSystemOnlineStatus();
  
  const activeTabPane = document.querySelector(".tab-pane.active");
  const activeTabId = activeTabPane ? activeTabPane.id : "";
  
  // Render only the active tab to optimize performance and prevent lagging
  if (!activeTabId) {
    renderWorkflowOverview();
    renderInspectionDashboard();
    renderMaskingDashboard();
    renderSprayingDashboard();
    renderGrindingDashboard();
    renderPolishingDashboard();
    renderFinalInspectionDashboard();
    renderDispatchDashboard();
    renderUserManagement();
    renderAuditLogs();
    renderDmdDashboard();
  } else {
    if (activeTabId === "tab-overview") renderWorkflowOverview();
    else if (activeTabId === "tab-inspection") renderInspectionDashboard();
    else if (activeTabId === "tab-masking") renderMaskingDashboard();
    else if (activeTabId === "tab-spraying") renderSprayingDashboard();
    else if (activeTabId === "tab-grinding") renderGrindingDashboard();
    else if (activeTabId === "tab-polishing") renderPolishingDashboard();
    else if (activeTabId === "tab-final-inspection") renderFinalInspectionDashboard();
    else if (activeTabId === "tab-dispatch") renderDispatchDashboard();
    else if (activeTabId === "tab-user-management") renderUserManagement();
    else if (activeTabId === "tab-audit-logs") renderAuditLogs();
    else if (activeTabId === "tab-data-management") renderDmdDashboard();
  }

  // Render weekly performance reports if active
  const reportsTab = document.getElementById("tab-reports");
  if (reportsTab && reportsTab.classList.contains("active")) {
    if (typeof initReportsTab === "function") {
      initReportsTab();
    }
  }

  // Update OEE UI immediately
  ["Masking", "Spraying", "Grinding", "Polishing"].forEach(dept => {
    // Only update OEE UI if the active tab is relevant to this department, or on initial load
    if (!activeTabId || activeTabId === `tab-${dept.toLowerCase()}`) {
      const state = loadOeeState(dept);
      const mode = getOeeCurrentMode(dept);
      updateOeeUi(dept, state, mode);
    }
  });
}

function updateSidebarCounts() {
  const countInspect = jobs.filter(j => j.currentDepartment === "Inspection").length;
  const countMasking = jobs.filter(j => j.currentDepartment === "Masking" && j.masking?.status !== "Completed").length;
  const countSpraying = jobs.filter(j => j.currentDepartment === "Spraying" && j.spraying?.status === "Pending").length;
  const countGrinding = jobs.filter(j => j.currentDepartment === "Grinding").length;
  const countPolishing = jobs.filter(j => j.currentDepartment === "Polishing").length;
  const countFinal = jobs.filter(j => j.currentDepartment === "Final Inspection").length;
  const countDispatch = jobs.filter(j => j.currentDepartment === "Dispatch").length;

  const badgeInspection = document.getElementById("badge-count-inspection");
  const badgeMasking = document.getElementById("badge-count-masking");
  const badgeSpraying = document.getElementById("badge-count-spraying");
  const badgeGrinding = document.getElementById("badge-count-grinding");
  const badgePolishing = document.getElementById("badge-count-polishing");
  const badgeFinal = document.getElementById("badge-count-final-inspection");
  const badgeDispatch = document.getElementById("badge-count-dispatch");

  if (badgeInspection) badgeInspection.textContent = countInspect;
  if (badgeMasking) badgeMasking.textContent = countMasking;
  if (badgeSpraying) badgeSpraying.textContent = countSpraying;
  if (badgeGrinding) badgeGrinding.textContent = countGrinding;
  if (badgePolishing) badgePolishing.textContent = countPolishing;
  if (badgeFinal) badgeFinal.textContent = countFinal;
  if (badgeDispatch) badgeDispatch.textContent = countDispatch;
}

// 7. TAB VIEW: MES WORKFLOW OVERVIEW
function renderWorkflowOverview() {
  const countInspect = jobs.filter(j => j.currentDepartment === "Inspection").length;
  const countMasking = jobs.filter(j => j.currentDepartment === "Masking" && j.masking.status !== "Completed").length;
  const countSpraying = jobs.filter(j => j.currentDepartment === "Spraying").length;
  const countGrinding = jobs.filter(j => j.currentDepartment === "Grinding").length;
  const countPolishing = jobs.filter(j => j.currentDepartment === "Polishing").length;
  const countFinal = jobs.filter(j => j.currentDepartment === "Final Inspection").length;
  const countDispatch = jobs.filter(j => j.currentDepartment === "Dispatch").length;

  document.getElementById("wf-count-inspection").textContent = countInspect;
  document.getElementById("wf-count-masking").textContent = countMasking;
  document.getElementById("wf-count-spraying").textContent = countSpraying;
  
  const wfGrinding = document.getElementById("wf-count-grinding");
  if (wfGrinding) wfGrinding.textContent = countGrinding;
  const wfPolishing = document.getElementById("wf-count-polishing");
  if (wfPolishing) wfPolishing.textContent = countPolishing;
  const wfFinal = document.getElementById("wf-count-final-inspection");
  if (wfFinal) wfFinal.textContent = countFinal;
  const wfDispatch = document.getElementById("wf-count-dispatch");
  if (wfDispatch) wfDispatch.textContent = countDispatch;

  const steps = [
    { id: "wf-step-inspection", count: countInspect },
    { id: "wf-step-masking", count: countMasking },
    { id: "wf-step-spraying", count: countSpraying },
    { id: "wf-step-grinding", count: countGrinding },
    { id: "wf-step-polishing", count: countPolishing },
    { id: "wf-step-final", count: countFinal },
    { id: "wf-step-dispatch", count: countDispatch }
  ];

  steps.forEach(step => {
    const el = document.getElementById(step.id);
    if (el) {
      if (step.count > 0) {
        el.classList.remove("disabled-step");
        el.classList.add("active-step");
      } else {
        el.classList.remove("active-step");
        el.classList.add("disabled-step");
      }
    }
  });

  // Filter jobs list for table & Kanban views
  const filteredJobs = getFilteredJobs(jobs);

  const activeJobs = filteredJobs.filter(j => j.currentDepartment !== "Dispatched" && j.status !== "Completed" && j.currentDepartment !== "Completed");
  const completedJobs = filteredJobs.filter(j => j.currentDepartment === "Dispatched" || j.status === "Completed" || j.currentDepartment === "Completed");
  
  // Show all active jobs plus the 20 most recently completed jobs in the active stage tracker table
  const displayJobs = [...activeJobs, ...completedJobs.slice(-20)];

  const tbody = document.getElementById("overview-jobs-list");
  tbody.innerHTML = "";

  displayJobs.forEach(job => {
    const tr = document.createElement("tr");
    
    let priorityClass = "";
    if (job.priority === "Critical") priorityClass = "text-red font-bold";
    else if (job.priority === "High") priorityClass = "text-orange";

    let statusBadge = "";
    if (job.status === "Pending") statusBadge = `<span class="badge badge-pending">Pending</span>`;
    else if (job.status === "In Progress") statusBadge = `<span class="badge badge-progress">In Progress</span>`;
    else if (job.status === "Completed") statusBadge = `<span class="badge badge-completed">Completed</span>`;
    else if (job.status === "Hold") statusBadge = `<span class="badge badge-hold">Hold</span>`;
    else statusBadge = `<span class="badge badge-normal">${job.status}</span>`;

    tr.innerHTML = `
      <td class="font-mono font-bold text-cyan">${getCleanKpNumber(job.kpNumber)}${getJobJcNo(job) ? ` (${getJobJcNo(job)})` : ""}</td>
      <td>${job.partName}</td>
      <td>${job.customer}</td>
      <td class="font-mono">${renderQuantityWithHistory(job, true)}</td>
      <td><span class="badge badge-normal">${job.processType}</span></td>
      <td><strong>${job.currentDepartment} Department</strong></td>
      <td>${statusBadge}</td>
      <td class="${priorityClass}">${job.priority}</td>
    `;
    tbody.appendChild(tr);
  });

  // Render secondary Zoho Project views
  renderGanttTimeline();
  renderKanbanBoard(activeJobs);
}

function renderGanttTimeline() {
  const container = document.getElementById("production-gantt-timeline");
  if (!container) return;
  
  const machines = [
    { id: "amba", name: "Amba (Grinding)", dept: "Grinding" },
    { id: "hmt", name: "HMT G17 (Grinding)", dept: "Grinding" },
    { id: "kirloskar", name: "Kirloskar MC.28 (Grinding)", dept: "Grinding" },
    { id: "zanetti", name: "Zanetti Toss (Grinding)", dept: "Grinding" },
    { id: "b-37", name: "Booth B-37 (Spraying)", dept: "Spraying" },
    { id: "c-20", name: "Booth C-20/4 (Spraying)", dept: "Spraying" },
    { id: "masking", name: "Masking Workbench", dept: "Masking" }
  ];
  
  let html = `
    <div class="gantt-chart-container">
      <div class="gantt-header-row">
        <div class="gantt-label-col">Resource / Machine</div>
        <div>08:00</div>
        <div>09:00</div>
        <div>10:00</div>
        <div>11:00</div>
        <div>12:00</div>
        <div>13:00</div>
        <div>14:00</div>
        <div>15:00</div>
        <div>16:00</div>
        <div>17:00</div>
        <div>18:00</div>
        <div>19:00</div>
      </div>
  `;
  
  machines.forEach(res => {
    let activeJob = null;
    if (res.dept === "Grinding") {
      activeJob = jobs.find(j => j.currentDepartment === "Grinding" && j.grinding?.status === "In Progress" && String(j.grinding?.machineName || "").toLowerCase().includes(res.id));
    } else if (res.dept === "Spraying") {
      activeJob = jobs.find(j => j.currentDepartment === "Spraying" && j.spraying?.status === "In Progress" && String(j.spraying?.booth || "").toLowerCase().includes(res.id));
    } else if (res.dept === "Masking") {
      activeJob = jobs.find(j => j.currentDepartment === "Masking" && j.masking?.status === "In Progress");
    }
    
    html += `
      <div class="gantt-row">
        <div class="gantt-label-col">${res.name}</div>
        <div class="gantt-timeline-cells">
    `;
    
    if (activeJob) {
      const kp = activeJob.kpNumber;
      const jc = getJobJcNo(activeJob);
      const label = `${kp}${jc ? ` (${jc})` : ""}`;
      const isHold = activeJob.status === "Hold" || (activeJob.spraying?.status === "Hold");
      const barClass = isHold ? "gantt-bar-item hold" : "gantt-bar-item";
      
      html += `
        <div class="${barClass}" style="left: 15%; width: 70%;" onclick="window.location.hash = '#tab-${res.dept.toLowerCase()}'">
          ${label} - In Progress (${activeJob.operatorName || "Unassigned"})
        </div>
      `;
    } else {
      html += `<div class="gantt-no-data">Resource Idle / Available</div>`;
    }
    
    html += `
        </div>
      </div>
    `;
  });
  
  html += `</div>`;
  container.innerHTML = html;
}

function renderKanbanBoard(filteredJobs) {
  const container = document.getElementById("overview-kanban-board");
  if (!container) return;
  
  const columns = [
    { title: "Inspection", stages: ["Inspection"] },
    { title: "Masking", stages: ["Masking"] },
    { title: "Spraying", stages: ["Spraying"] },
    { title: "Grinding & Polishing", stages: ["Grinding", "Polishing"] },
    { title: "Final QA & Dispatch", stages: ["Final Inspection", "Dispatch"] }
  ];
  
  container.innerHTML = "";
  
  columns.forEach(col => {
    const columnJobs = filteredJobs.filter(j => col.stages.includes(j.currentDepartment));
    
    const colDiv = document.createElement("div");
    colDiv.className = "kanban-column";
    colDiv.id = `kanban-col-${col.title.replace(/\s+/g, '-').toLowerCase()}`;
    
    colDiv.setAttribute("ondragover", "event.preventDefault(); this.classList.add('drag-over')");
    colDiv.setAttribute("ondragleave", "this.classList.remove('drag-over')");
    colDiv.setAttribute("ondrop", `handleKanbanDrop(event, '${col.stages[0]}'); this.classList.remove('drag-over')`);
    
    colDiv.innerHTML = `
      <div class="kanban-column-header">
        <span class="kanban-column-title">${col.title}</span>
        <span class="kanban-column-count">${columnJobs.length}</span>
      </div>
      <div class="kanban-column-body"></div>
    `;
    
    const body = colDiv.querySelector(".kanban-column-body");
    
    columnJobs.forEach(job => {
      const card = document.createElement("div");
      card.className = "kanban-card";
      card.draggable = true;
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", job.kpNumber);
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
      });
      
      const priorityClass = String(job.priority || "Normal").toLowerCase();
      const cleanJc = getJobJcNo(job);
      
      card.innerHTML = `
        <div class="kanban-card-header">
          <span class="kanban-card-kp">${getCleanKpNumber(job.kpNumber)}${cleanJc ? ` (${cleanJc})` : ""}</span>
          <span class="kanban-card-priority ${priorityClass}" title="Priority: ${job.priority}"></span>
        </div>
        <div class="kanban-card-part">${job.partName || "No Part Name"}</div>
        <div class="kanban-card-cust">${job.customer || "No Customer"}</div>
        <div class="kanban-card-footer">
          <span class="kanban-card-qty">${job.quantity} pcs</span>
          <span class="kanban-card-status badge-${String(job.status || "pending").toLowerCase().replace(/\s+/g, '-')}">${job.status || "Pending"}</span>
        </div>
      `;
      
      card.addEventListener("click", () => {
        const destTab = job.currentDepartment.toLowerCase().replace(/\s+/g, '-');
        window.location.hash = `#tab-${destTab}`;
      });
      
      body.appendChild(card);
    });
    
    container.appendChild(colDiv);
  });
}

async function handleKanbanDrop(event, targetStage) {
  event.preventDefault();
  const kpNumber = event.dataTransfer.getData("text/plain");
  if (!kpNumber) return;
  
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (!job) return;
  
  if (job.currentDepartment === targetStage) return;
  
  showToast("Kanban Router", `Directing to ${targetStage} stage for job ${kpNumber}.`, "info");
  
  const destTab = targetStage.toLowerCase().replace(/\s+/g, '-');
  window.location.hash = `#tab-${destTab}`;
  
  setTimeout(() => {
    alert(`Please complete the standard workflow controls for ${kpNumber} on the ${targetStage} panel.`);
  }, 100);
}

window.renderGanttTimeline = renderGanttTimeline;
window.renderKanbanBoard = renderKanbanBoard;
window.handleKanbanDrop = handleKanbanDrop;

// ── Global helper: transition a job to any stage ──
function transitionToStage(job, stageName, operatorName) {
  job.currentDepartment = stageName;
  job.status = "Pending";
  job.splitRemark = "";
  
  if (stageName === "Masking") {
    job.masking = job.masking || {};
    job.masking.status = "Pending";
    if (!job.masking.materials || job.masking.materials.length === 0) {
      job.masking.materials = [
        { name: "Masking Tape", type: "Tape", batch: "MT-2026-06", unit: "KG", plannedQty: job.quantity, actualQty: 0 },
        { name: "High Temperature Putty", type: "Sealant", batch: "HTP-9921", unit: "Gram", plannedQty: 350, actualQty: 0 }
      ];
    }
  } else if (stageName === "Spraying") {
    job.spraying = job.spraying || {};
    job.spraying.status = "Pending";
  } else if (stageName === "Grinding") {
    job.grinding = job.grinding || {};
    job.grinding.status = "Pending";
    job.grinding.processType = "";
    job.grinding.machineName = "";
    job.grinding.storeLocation = "";
    job.grinding.quantity = job.quantity;
    job.grinding.startTime = null;
    job.grinding.endTime = null;
    job.grinding.durationMs = 0;
    job.grinding.activeTimeMs = 0;
    job.grinding.lastStartedAt = null;
    job.grinding.lastPausedAt = null;
    job.grinding.holdHistory = [];
    job.grinding.operatorName = "";
    job.grinding.remarks = "";
    job.grinding.qualityRemarks = "";
    job.grinding.notes = "";
  } else if (stageName === "Polishing") {
    job.polishing = job.polishing || {};
    job.polishing.status = "Pending";
  } else if (stageName === "Final Inspection") {
    job.finalInspection = job.finalInspection || {};
    job.finalInspection.status = "Pending";
  } else if (stageName === "Dispatch") {
    job.dispatch = job.dispatch || {};
    job.dispatch.status = "Pending";
  }
}

// ==================== ZOHO INTERACTIVE TRANSITION DRAG & UNDO PIPELINE ====================
window.pendingTransition = null;
window.undoTimerId = null;
window.undoIntervalId = null;
window.undoActiveState = null;

function showFloatingCardTransition(job, stageName, payloadGenerator, applyLocalMutation) {
  window.pendingTransition = {
    job: job,
    stage: stageName,
    payloadGenerator: payloadGenerator,
    applyLocalMutation: applyLocalMutation
  };

  const overlay = document.getElementById("transition-drag-overlay");
  if (overlay) {
    overlay.style.display = "flex";
  }

  loadFloatingCardInfo(job);
}

function loadFloatingCardInfo(job) {
  const card = document.getElementById("floating-drag-card");
  if (!card) return;

  const cleanJc = getJobJcNo(job);
  const priorityClass = String(job.priority || "Normal").toLowerCase();
  
  card.innerHTML = `
    <div class="stage-card-priority-strip ${priorityClass}"></div>
    <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <span class="font-mono font-bold text-cyan" style="font-size: 16px;">${getCleanKpNumber(job.kpNumber)}${cleanJc ? ` (${cleanJc})` : ""}</span>
      <span class="badge badge-normal" style="font-size:10px; font-weight:700;">${job.processType}</span>
    </div>
    <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">${job.partName}</div>
    <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">Customer: ${job.customer}</div>
    <div style="font-size: 13px; font-weight: 700; color: var(--text-highlight);">Quantity: ${job.quantity} pcs</div>
    <div style="font-size: 11px; margin-top: 15px; color: var(--text-muted); text-align: center; border: 1px dashed var(--border-color); padding: 8px; border-radius: 6px;">
      DRAG ME TO THE TARGET STAGE BELOW
    </div>
  `;

  card.classList.remove("dragging");
  card.style.animation = "floatCenterIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards, shakeCard 1.5s ease-in-out infinite alternate";
}

function initTransitionDragHandlers() {
  const card = document.getElementById("floating-drag-card");
  const zones = document.querySelectorAll(".drop-target-stage");
  const overlay = document.getElementById("transition-drag-overlay");

  if (card) {
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", "floating-card");
      card.classList.add("dragging");
      card.style.animation = "none"; // Stop shaking while dragging
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      if (!window.pendingTransition && overlay) {
        overlay.style.display = "none";
      } else {
        card.style.animation = "shakeCard 1.5s ease-in-out infinite alternate";
      }
    });
  }

  zones.forEach(zone => {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("drag-active");
    });
    zone.addEventListener("dragleave", () => {
      zone.classList.remove("drag-active");
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-active");
      const targetStage = zone.getAttribute("data-target-stage");
      if (window.pendingTransition && targetStage) {
        applyStageTransitionWithUndo(targetStage);
      }
    });
    // Support mobile/touch tap fallback
    zone.addEventListener("click", () => {
      const targetStage = zone.getAttribute("data-target-stage");
      if (window.pendingTransition && targetStage) {
        applyStageTransitionWithUndo(targetStage);
      }
    });
  });

  const undoBtn = document.getElementById("btn-global-undo");
  if (undoBtn) {
    undoBtn.addEventListener("click", triggerUndoLastTransition);
  }
}

function isBackwardTransition(currentStage, targetStage) {
  const STAGE_ORDER = ["Inspection", "Masking", "Spraying", "Grinding", "Polishing", "Final Inspection", "Dispatch", "Dispatched", "Completed"];
  const currIdx = STAGE_ORDER.indexOf(currentStage);
  const targetIdx = STAGE_ORDER.indexOf(targetStage);
  if (currIdx === -1 || targetIdx === -1) return false;
  return targetIdx < currIdx;
}

function applyStageTransitionWithUndo(targetStage) {
  if (!window.pendingTransition) return;
  const trans = window.pendingTransition;
  const currentStage = trans.stage;

  if (isBackwardTransition(currentStage, targetStage)) {
    // Hide drag overlay temporarily
    const dragOverlay = document.getElementById("transition-drag-overlay");
    if (dragOverlay) dragOverlay.style.display = "none";

    // Show rework reason modal
    const reworkModal = document.getElementById("modal-rework-reason");
    const fromEl = document.getElementById("rework-from-stage");
    const toEl = document.getElementById("rework-to-stage");
    if (fromEl) fromEl.textContent = currentStage;
    if (toEl) toEl.textContent = targetStage;
    
    // Reset form values
    const form = document.getElementById("rework-reason-form");
    const select = document.getElementById("rework-reason-select");
    const comments = document.getElementById("rework-custom-input");
    if (select) select.value = "";
    if (comments) comments.value = "";
    
    if (reworkModal) reworkModal.style.display = "flex";

    // Setup Cancel button handler
    const cancelBtn = document.getElementById("btn-cancel-rework");
    const handleCancel = () => {
      reworkModal.style.display = "none";
      if (dragOverlay) dragOverlay.style.display = "flex";
      cancelBtn.removeEventListener("click", handleCancel);
      form.removeEventListener("submit", handleSubmit);
    };
    cancelBtn.addEventListener("click", handleCancel);

    // Setup Submit handler
    const handleSubmit = (e) => {
      e.preventDefault();
      const reasonVal = select.value;
      const commentsVal = comments.value;
      
      reworkModal.style.display = "none";
      cancelBtn.removeEventListener("click", handleCancel);
      form.removeEventListener("submit", handleSubmit);
      
      // Continue transition with enriched payload parameters
      executeStageTransition(targetStage, reasonVal, commentsVal);
    };
    form.addEventListener("submit", handleSubmit);

    return; // Break normal flow to await form submission
  }

  // Normal Forward Flow
  executeStageTransition(targetStage);
}

function executeStageTransition(targetStage, reworkReason = null, reworkComments = null) {
  if (!window.pendingTransition) return;
  const trans = window.pendingTransition;

  // Save the pre-transition state of jobs
  window.undoActiveState = JSON.parse(JSON.stringify(jobs));

  // Apply local mutation
  trans.applyLocalMutation(targetStage);
  
  if (trans.job) {
    if (!trans.job.stageAssignedAt) trans.job.stageAssignedAt = {};
    const key = targetStage.toLowerCase().replace(/[^a-z]/g, "");
    trans.job.stageAssignedAt[key] = new Date().toISOString();
  }

  // Generate payload
  const payload = trans.payloadGenerator(targetStage);
  if (payload) {
    if (reworkReason) payload.reworkReasonCategory = reworkReason;
    if (reworkComments) payload.reworkReasonComments = reworkComments;
  }

  // Hide floating overlay
  const overlay = document.getElementById("transition-drag-overlay");
  if (overlay) overlay.style.display = "none";

  window.pendingTransition = null;
  window.lastTransitionPayload = payload;

  // Persist locally immediately
  saveState();
  renderAll();

  // Commit to Server/Firebase IMMEDIATELY to prevent data loss on refresh
  if (payload) {
    (async () => {
      try {
        if (!isMockMode() && sendBackendPost) {
          await sendBackendPost(payload);
        }
        let logMsg = `Job routed to next stage: ${payload.nextStage}`;
        if (payload.reworkReasonCategory) {
          logMsg = `Job sent back to previous stage: ${payload.nextStage}. Reason Category: ${payload.reworkReasonCategory}. Comments: ${payload.reworkReasonComments || "None"}`;
        }
        await createFirestoreAuditLog(
          payload.operatorName || getLoggedUser().name,
          payload.stage || "System",
          payload.kpNo,
          payload.reworkReasonCategory ? "Rework Pushback" : "Stage Transition",
          logMsg
        );
      } catch (err) {
        console.error("Failed to sync stage transition:", err);
        handleFirestoreError("stage-transition-write", err);
      }
    })();
  }

  // Trigger the 10-second undo countdown banner (purely visual now)
  startUndoCountdown(payload);
}

function startUndoCountdown(payload) {
  const banner = document.getElementById("undo-countdown-banner");
  const secondsEl = document.getElementById("undo-timer-seconds");
  const fillEl = document.getElementById("undo-progress-fill");
  if (!banner) return;

  if (window.undoTimerId) clearTimeout(window.undoTimerId);
  if (window.undoIntervalId) clearInterval(window.undoIntervalId);

  let timeLeft = 10;
  secondsEl.textContent = timeLeft;
  fillEl.style.width = "100%";
  banner.style.display = "flex";

  // Tick the progress fill and seconds
  window.undoIntervalId = setInterval(() => {
    timeLeft--;
    if (timeLeft >= 0) {
      secondsEl.textContent = timeLeft;
      fillEl.style.width = `${timeLeft * 10}%`;
    }
  }, 1000);

  // Commit on timeout (just hides visual banner)
  window.undoTimerId = setTimeout(() => {
    clearInterval(window.undoIntervalId);
    banner.style.display = "none";
    window.undoTimerId = null;
    window.undoIntervalId = null;
    window.undoActiveState = null;
    window.lastTransitionPayload = null;
  }, 10000);
}

function triggerUndoLastTransition() {
  if (window.undoTimerId) clearTimeout(window.undoTimerId);
  if (window.undoIntervalId) clearInterval(window.undoIntervalId);
  
  window.undoTimerId = null;
  window.undoIntervalId = null;

  const banner = document.getElementById("undo-countdown-banner");
  if (banner) banner.style.display = "none";

  if (window.undoActiveState) {
    const payload = window.lastTransitionPayload;
    jobs = window.undoActiveState;
    window.undoActiveState = null;
    window.lastTransitionPayload = null;
    saveState();
    renderAll();
    
    // Rollback Firebase immediately
    if (!isMockMode() && payload && payload.kpNo) {
      (async () => {
        try {
          const db = firebase.firestore();
          const snap = await db.collection("jobs").where("kpNumber", "==", payload.kpNo).get();
          if (!snap.empty) {
            const jobRef = snap.docs[0].ref;
            const targetJob = jobs.find(j => j.kpNumber === payload.kpNo);
            if (targetJob) {
              const stageKey = payload.stage.toLowerCase().replace(/[^a-z]/g, "");
              const nextStageKey = (payload.nextStage || "").toLowerCase().replace(/[^a-z]/g, "");
              
              const rollbackUpdates = {
                currentStage: payload.stage,
                currentStatus: targetJob.status || "Pending",
                assignedOperator: targetJob.operatorName ? { uid: "", name: targetJob.operatorName } : null,
                shift: targetJob.shift || "",
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
              };
              
              if (stageKey) {
                rollbackUpdates[stageKey] = {
                  status: targetJob[stageKey]?.status || "Pending",
                  operatorName: targetJob[stageKey]?.operatorName || "",
                  endTime: null,
                  durationMs: targetJob[stageKey]?.durationMs || 0,
                  activeTimeMs: targetJob[stageKey]?.activeTimeMs || 0,
                  holdHistory: targetJob[stageKey]?.holdHistory || []
                };
              }
              if (nextStageKey) {
                rollbackUpdates[nextStageKey] = {
                  status: targetJob[nextStageKey]?.status || "Pending"
                };
              }
              
              await jobRef.update(rollbackUpdates);
              
              await createFirestoreAuditLog(
                payload.operatorName || getLoggedUser().name,
                payload.stage || "System",
                payload.kpNo,
                "Undo Transition",
                `Operator undid stage transition. Reverted job back to ${payload.stage}`
              );
            }
          }
        } catch (err) {
          console.error("Failed to rollback Firestore stage transition:", err);
        }
      })();
    }
    
    alert("Transition reverted successfully!");
  }
}

// 8. TAB VIEW: INSPECTION DASHBOARD (Simulated Job Registration & Approval)
function triggerInspectionFloatingTransition(kpNumber) {
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (!job) return;

  const payloadGenerator = (nextStage) => {
    return {
      type: "APPROVE_JOB",
      kpNo: job.kpNumber,
      stage: "Inspection",
      nextStage: nextStage,
      operatorName: getLoggedUser().name,
      time: new Date().toISOString()
    };
  };

  const applyLocalMutation = (nextStage) => {
    job.status = "In Progress";
    job.currentDepartment = nextStage;
    if (nextStage === "Masking") {
      job.masking = job.masking || {
        status: "Pending",
        operatorName: "",
        startTime: null,
        endTime: null,
        durationMs: 0,
        materials: []
      };
    }
  };

  showFloatingCardTransition(job, "Inspection", payloadGenerator, applyLocalMutation);
}