
// Controller: Show local loading message & disable inspection inputs
function showInspectionLoading() {
  const loadingEl = document.getElementById("inspection-loading-msg");
  if (loadingEl) loadingEl.style.display = "flex";
  
  const errorEl = document.getElementById("inspection-error-msg");
  if (errorEl) errorEl.style.display = "none";

  const form = document.getElementById("inspection-job-form");
  if (form) {
    form.querySelectorAll("select, input, button:not(#btn-refresh-inspection)").forEach(el => el.disabled = true);
  }
}

// Controller: Hide local loading message & restore inspection inputs
function hideInspectionLoading() {
  const loadingEl = document.getElementById("inspection-loading-msg");
  if (loadingEl) loadingEl.style.display = "none";

  const form = document.getElementById("inspection-job-form");
  if (form) {
    form.querySelectorAll("select, input, button").forEach(el => {
      el.disabled = false;
    });
  }
}

// Unique counter for JSONP callbacks to prevent naming collisions on rapid calls
let _gvizCbCounter = 0;

async function fetchGVizData(queryString) {
  // Use JSONP (script injection) to bypass CORS — no fetch needed
  return new Promise((resolve, reject) => {
    // Use counter + timestamp for guaranteed unique callback names
    const callbackName = '_gvizCb_' + (++_gvizCbCounter) + '_' + Date.now();
    let script;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("GViz JSONP request timed out after 35s"));
    }, 35000);
    
    function cleanup() {
      clearTimeout(timeout);
      // Replace with a self-deleting no-op to prevent late script responses from throwing "not defined" errors
      window[callbackName] = function() {
        try { delete window[callbackName]; } catch(e) {}
      };
      try { if (script && script.parentNode) script.parentNode.removeChild(script); } catch(e) {}
    }
    
    window[callbackName] = function(response) {
      cleanup();
      if (response && response.status === 'error') {
        reject(new Error(response.errors && response.errors[0] ? response.errors[0].detailed_message : "GViz Query Error"));
      } else {
        resolve(response ? response.table : null);
      }
    };
    
    const url = `https://docs.google.com/spreadsheets/d/1ip55xEk5rtdqqhCeJ8Hx0IT6aBfnO_0eFIEKh3a7cYg/gviz/tq?sheet=FMS&range=A5:AZ3500&tqx=out:json;responseHandler:${callbackName}&tq=${encodeURIComponent(queryString)}`;
    script = document.createElement('script');
    script.src = url;
    script.onerror = () => {
      cleanup();
      reject(new Error("GViz JSONP script load failed"));
    };
    document.head.appendChild(script);
  });
}

function showInspectionError(message) {
  const errorEl = document.getElementById("inspection-error-msg");
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = "block";
  }
  const form = document.getElementById("inspection-job-form");
  if (form) {
    const elements = form.querySelectorAll("input, select, button");
    elements.forEach(el => {
      el.disabled = true;
    });
  }
}

function hideInspectionError() {
  const errorEl = document.getElementById("inspection-error-msg");
  if (errorEl) {
    errorEl.style.display = "none";
  }
  const form = document.getElementById("inspection-job-form");
  if (form) {
    const elements = form.querySelectorAll("input, select, button");
    elements.forEach(el => {
      el.disabled = false;
    });
  }
}

let inspectionMasterRecords = [];
let isUpdatingDropdowns = false;
// Request lock: prevents overlapping inspection data fetches
let _inspectionFetchInProgress = false;
// Retry counter for exponential backoff
let _inspectionRetryCount = 0;
const _INSPECTION_MAX_RETRIES = 3;

function populateInspectionDropdowns() {
  updateInspectionDropdowns();
}

function updateInspectionDropdowns() {
  if (isUpdatingDropdowns) return;
  isUpdatingDropdowns = true;
  
  try {
    const kpSelect = document.getElementById("inspect-kp-no");
    const partSelect = document.getElementById("inspect-part-name");
    const custSelect = document.getElementById("inspect-customer");
    const qtySelect = document.getElementById("inspect-quantity");
    
    if (!kpSelect || !partSelect || !custSelect || !qtySelect) return;
    
    const currentKp = kpSelect.value;
    const currentPart = partSelect.value;
    const currentCust = custSelect.value;
    const currentQty = qtySelect.value;
    
    // Exclude delivered records from all operator dropdowns (case-insensitive)
    const activeRecords = inspectionMasterRecords.filter(r => !r.status || r.status.toLowerCase() !== 'delivered');
    
    const isKpSelected = !!currentKp;
    
    // 1. Filter records for KP Number dropdown (based on Part, Customer, Qty filters)
    // If a KP is already selected, we bypass filtering the KP list by the auto-populated fields so the user can change selection.
    const kpRecords = activeRecords.filter(r => {
      if (!isKpSelected) {
        if (currentPart && r.partName !== currentPart) return false;
        if (currentCust && r.customer !== currentCust) return false;
        if (currentQty && r.quantity !== currentQty) return false;
      }
      return true;
    });
    const validKps = [...new Set(kpRecords.map(r => r.kpNo).filter(Boolean))].sort();
    
    // 2. Filter records for Part Name dropdown (based on KP, Customer, Qty filters)
    const partRecords = activeRecords.filter(r => {
      if (currentKp && r.kpNo !== currentKp) return false;
      if (currentCust && r.customer !== currentCust) return false;
      if (currentQty && r.quantity !== currentQty) return false;
      return true;
    });
    const validParts = [...new Set(partRecords.map(r => r.partName).filter(Boolean))].sort();
    
    // 3. Filter records for Customer Name dropdown (based on KP, Part, Qty filters)
    const custRecords = activeRecords.filter(r => {
      if (currentKp && r.kpNo !== currentKp) return false;
      if (currentPart && r.partName !== currentPart) return false;
      if (currentQty && r.quantity !== currentQty) return false;
      return true;
    });
    const validCusts = [...new Set(custRecords.map(r => r.customer).filter(Boolean))].sort();
    
    // 4. Filter records for Quantity dropdown (based on KP, Part, Customer filters)
    const qtyRecords = activeRecords.filter(r => {
      if (currentKp && r.kpNo !== currentKp) return false;
      if (currentPart && r.partName !== currentPart) return false;
      if (currentCust && r.customer !== currentCust) return false;
      return true;
    });
    const validQtys = [...new Set(qtyRecords.map(r => r.quantity).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
    
    // Populate KP select
    kpSelect.innerHTML = '<option value="">-- Select KP Number --</option>';
    validKps.forEach(kp => {
      const opt = document.createElement("option");
      opt.value = kp;
      opt.textContent = kp;
      kpSelect.appendChild(opt);
    });
    kpSelect.value = validKps.includes(currentKp) ? currentKp : "";
    
    // Populate Part select
    partSelect.innerHTML = '<option value="">-- Select Part Name --</option>';
    validParts.forEach(part => {
      const opt = document.createElement("option");
      opt.value = part;
      opt.textContent = part;
      partSelect.appendChild(opt);
    });
    
    // Populate Customer select
    custSelect.innerHTML = '<option value="">-- Select Customer Name --</option>';
    validCusts.forEach(cust => {
      const opt = document.createElement("option");
      opt.value = cust;
      opt.textContent = cust;
      custSelect.appendChild(opt);
    });
    
    // Populate Quantity select
    qtySelect.innerHTML = '<option value="">-- Select Quantity --</option>';
    validQtys.forEach(qty => {
      const opt = document.createElement("option");
      opt.value = qty;
      opt.textContent = qty;
      qtySelect.appendChild(opt);
    });

    // Auto-select and lock fields if a KP is selected, otherwise leave editable
    if (kpSelect.value) {
      if (validParts.length === 1) partSelect.value = validParts[0];
      if (validCusts.length === 1) custSelect.value = validCusts[0];
      if (validQtys.length === 1) qtySelect.value = validQtys[0];

      partSelect.disabled = true;
      custSelect.disabled = true;
      qtySelect.disabled = true;
    } else {
      const wasLocked = partSelect.disabled || custSelect.disabled || qtySelect.disabled;
      
      partSelect.disabled = false;
      custSelect.disabled = false;
      qtySelect.disabled = false;

      if (wasLocked) {
        partSelect.value = "";
        custSelect.value = "";
        qtySelect.value = "";
      } else {
        partSelect.value = validParts.includes(currentPart) ? currentPart : "";
        custSelect.value = validCusts.includes(currentCust) ? currentCust : "";
        qtySelect.value = validQtys.includes(currentQty) ? currentQty : "";
      }
    }
    
    // Check if we have a single fully selected match
    const finalMatches = activeRecords.filter(r => 
      r.kpNo === kpSelect.value && 
      r.partName === partSelect.value && 
      r.customer === custSelect.value && 
      r.quantity === qtySelect.value
    );
    
    if (finalMatches.length === 1 && kpSelect.value && partSelect.value && custSelect.value && qtySelect.value) {
      activeInspectionRecord = finalMatches[0];
    } else {
      activeInspectionRecord = null;
    }
  } catch (err) {
    console.error("Error updating inspection dropdowns:", err);
  } finally {
    isUpdatingDropdowns = false;
  }
}

async function loadInspectionKPs(forceRefresh = false, isAutoRefresh = false) {
  if (isMockMode()) {
    console.log("[Inspection] Skipped Google Sheets fetch in Mock Mode.");
    return;
  }

  // ─── Request Lock: Skip if another fetch is already running ───
  if (_inspectionFetchInProgress) {
    console.log("[Inspection] Fetch already in progress — ignoring concurrent request.");
    return;
  }

  // ─── Cache Check: skip if cache is fresh and we aren't forcing a refresh ───
  const now = Date.now();
  const isCacheFresh = (now - lastInspectionFetchTime) < INSPECTION_REFRESH_INTERVAL_MS;
  if (!forceRefresh && inspectionMasterRecords.length > 0 && isCacheFresh) {
    console.log("[Inspection] Using cached data (freshness: " + Math.round((now - lastInspectionFetchTime) / 1000) + "s)");
    return;
  }

  // ─── Edit guard: skip if user is actively editing the inspection form ───
  if (isAutoRefresh && isUserEditingInspectionForm()) {
    console.log("[Inspection] Auto-refresh skipped — User is currently interacting with the form.");
    return;
  }

  _inspectionFetchInProgress = true;
  showInspectionLoading();

  // ─── Auth state: ensure currentUser is available ───
  const userEmail = currentUser && currentUser.email ? currentUser.email : null;
  const userRole  = currentUser && currentUser.role  ? currentUser.role  : null;
  const isOp      = userRole === 'operator';
  const op        = isOp && userEmail ? getOperatorCode(userEmail) : "";

  console.log("[Inspection] Starting fetch.",
    "User:", userEmail || "(none)",
    "Role:", userRole  || "(none)",
    "Operator:", op || "(admin/all)",
    "Force:", forceRefresh,
    "Auto:", isAutoRefresh
  );

  try {
    // Query column T (KP No), F (Customer), I (Part Name), J (Qty), C (Delivered Status), V (Assigned), A (Timestamp), X (Actual), Y (Status), S (JC No), AM (FIR ST), AU (Process Type), W (Inspection/Arrival Date), AK (Planned Completion Date)
    let query = "SELECT T, F, I, J, C, V, A, X, Y, S, AM, AU, W, AK WHERE T IS NOT NULL AND (C IS NULL OR LOWER(C) != 'delivered')";
    if (op) {
      const lowerOp = op.trim().toLowerCase();
      query += ` AND (LOWER(V) = '${lowerOp}' OR LOWER(V) LIKE '${lowerOp} /%' OR LOWER(V) LIKE '%/ ${lowerOp}' OR LOWER(V) LIKE '%/ ${lowerOp} /%')`;
    }

    let kpTable = null;
    let lastError = null;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[Inspection] Fetching via GViz (Attempt ${attempt}/${maxAttempts})...`);
        kpTable = await fetchGVizData(query);
        break; // success
      } catch (err) {
        lastError = err;
        console.warn(`[Inspection] Attempt ${attempt} failed: ${err.message}`);
        if (attempt < maxAttempts) {
          const delay = attempt * 1500;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    if (!kpTable) {
      throw lastError || new Error("Failed to fetch GViz table after retries");
    }

    const rows = kpTable.rows || [];
    console.log("[Inspection] GViz returned", rows.length, "rows.");

    // ─── Parse rows off-main-thread with Web Worker (with Main-Thread fallback) ───
    let parsedRecords = [];
    try {
      parsedRecords = await parseRowsWithWorker(rows, op);
    } catch (workerErr) {
      console.warn("[Inspection] Web Worker parsing failed, using main-thread fallback:", workerErr.message);
      parsedRecords = await parseRowsMainThreadAsync(rows, op);
    }

    // ─── Apply results ───
    inspectionMasterRecords = parsedRecords;
    lastInspectionFetchTime = Date.now();
    _inspectionRetryCount = 0;
    
    console.log("[Inspection] ✅ Data loaded. Records count:", inspectionMasterRecords.length);
    
    // Build KP to JC map
    window.kpToJcMap = {};
    parsedRecords.forEach(r => {
      if (r.kpNo && r.jcNo) {
        window.kpToJcMap[r.kpNo.toUpperCase()] = r.jcNo;
      }
    });

    // Persist KP→JC map to localStorage for instant loading on next page load
    try {
      localStorage.setItem("psp_kp_to_jc_map", JSON.stringify(window.kpToJcMap));
    } catch (e) {
      console.warn("[Inspection] Failed to cache KP→JC map:", e);
    }

    // Also update any loaded jobs in memory
    if (Array.isArray(window.jobs)) {
      window.jobs.forEach(j => {
        if (j.kpNumber) {
          const mappedJc = window.kpToJcMap[j.kpNumber.toUpperCase()];
          if (mappedJc) {
            j.jcNo = mappedJc;
          }
        }
      });
    }

    populateInspectionDropdowns();
    hideInspectionLoading();
    hideInspectionError();
    
    // Auto-sync spreadsheet records to Inspection/Masking stages
    await autoSyncJobsFromSpreadsheet(parsedRecords);

  } catch (err) {
    console.error("[Inspection] ❌ Load failed:", err.message);
    if (inspectionMasterRecords.length > 0) {
      console.warn("[Inspection] Retaining " + inspectionMasterRecords.length + " cached records in UI.");
      hideInspectionLoading();
    } else {
      hideInspectionLoading();
      showInspectionError("Inspection data temporarily unavailable. Tap 🔄 Refresh to retry.");
    }
  } finally {
    _inspectionFetchInProgress = false;
  }
}

const SUB_STATUS_ORDER = ["Intake", "Visual", "Dimensional", "Review", "Ready"];

function moveInspectionSubStatus(kpNumber) {
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (!job) return;
  
  const currentSubStatus = job.inspection?.subStatus || "Intake";
  const currentIndex = SUB_STATUS_ORDER.indexOf(currentSubStatus);
  if (currentIndex === -1 || currentIndex === SUB_STATUS_ORDER.length - 1) return;
  
  const nextStatus = SUB_STATUS_ORDER[currentIndex + 1];
  updateInspectionSubStatusLocalAndRemote(job, nextStatus);
}
window.moveInspectionSubStatus = moveInspectionSubStatus;

async function handleInspectionKanbanDrop(event, targetStatus) {
  event.preventDefault();
  const kpNumber = event.dataTransfer.getData("text/plain");
  if (!kpNumber) return;

  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (!job) return;

  updateInspectionSubStatusLocalAndRemote(job, targetStatus);
}
window.handleInspectionKanbanDrop = handleInspectionKanbanDrop;

async function updateInspectionSubStatusLocalAndRemote(job, targetStatus) {
  if (targetStatus === "Ready") {
    triggerInspectionFloatingTransition(job.kpNumber);
    return;
  }

  if (!job.inspection) {
    job.inspection = { status: "Pending" };
  }
  job.inspection.subStatus = targetStatus;
  
  renderInspectionDashboard();

  const isMock = !firebaseConfig.apiKey || firebaseConfig.apiKey.includes("YOUR_FIREBASE_") || localStorage.getItem("psp_auth_mock") === "true";
  if (!isMock) {
    try {
      const db = firebase.firestore();
      const snap = await db.collection("jobs").where("kpNumber", "==", job.kpNumber).get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({
          "inspection.subStatus": targetStatus
        });
      }
    } catch (err) {
      console.error("Firestore inspection subStatus update error:", err);
    }
  } else {
    const mockDbJobs = JSON.parse(localStorage.getItem('mock_db_jobs') || '[]');
    const idx = mockDbJobs.findIndex(j => j.kpNumber === job.kpNumber);
    if (idx !== -1) {
      if (!mockDbJobs[idx].inspection) mockDbJobs[idx].inspection = { status: "Pending" };
      mockDbJobs[idx].inspection.subStatus = targetStatus;
      localStorage.setItem('mock_db_jobs', JSON.stringify(mockDbJobs));
    }
  }

  if (typeof showToast === 'function') {
    showToast("Sub-Stage Updated", `${job.kpNumber} moved to ${targetStatus} stage.`, "success");
  }
}

function renderInspectionDashboard() {
  const cardsIntake = document.getElementById("cards-intake");
  const cardsVisual = document.getElementById("cards-visual");
  const cardsDimensional = document.getElementById("cards-dimensional");
  const cardsReview = document.getElementById("cards-review");
  const cardsReady = document.getElementById("cards-ready");

  if (!cardsIntake || !cardsVisual || !cardsDimensional || !cardsReview || !cardsReady) return;

  cardsIntake.innerHTML = "";
  cardsVisual.innerHTML = "";
  cardsDimensional.innerHTML = "";
  cardsReview.innerHTML = "";
  cardsReady.innerHTML = "";

  const inspectJobs = jobs.filter(j => j.currentDepartment === "Inspection");

  let countIntake = 0;
  let countVisual = 0;
  let countDimensional = 0;
  let countReview = 0;
  let countReady = 0;

  inspectJobs.forEach(job => {
    const subStatus = job.inspection?.subStatus || "Intake";
    const cleanJc = getJobJcNo(job);
    const priorityClass = String(job.priority || "Normal").toLowerCase();
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

    const jobStatus = job.status || "Pending";
    const statusBadgeStyle = jobStatus.toLowerCase() === "completed"
      ? "background:#10b981;color:#fff;"
      : "background:#f97316;color:#fff;";

    card.innerHTML = `
      <div class="kanban-card-header">
        <span class="kanban-card-kp">${getCleanKpNumber(job.kpNumber)}${cleanJc ? ` (${cleanJc})` : ""}</span>
        <span class="kanban-card-priority ${priorityClass}" title="Priority: ${job.priority || 'Normal'}"></span>
      </div>
      <div class="kanban-card-part">${job.partName || "—"}</div>
      <div class="kanban-card-cust">${job.customer || "—"}</div>
      <div class="kanban-card-footer">
        <span class="kanban-card-qty">${job.quantity || "—"} pcs</span>
        <span style="font-size:10px;font-weight:700;padding:2px 10px;border-radius:4px;${statusBadgeStyle}">${jobStatus.toUpperCase()}</span>
      </div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);">
        ${subStatus === 'Ready'
          ? `<button class="btn btn-success btn-xs" style="width:100%;height:28px;font-size:10px;font-weight:700;" onclick="event.stopPropagation();triggerInspectionFloatingTransition('${job.kpNumber}')">🚀 Approve &amp; Push Job</button>`
          : `<button class="btn btn-secondary btn-xs" style="width:100%;height:28px;font-size:10px;" onclick="event.stopPropagation();moveInspectionSubStatus('${job.kpNumber}')">→ Move to Next Stage</button>`
        }
        ${buildDeleteJobButtonHTML(job.kpNumber)}
      </div>
    `;

    if (subStatus === "Intake") {
      cardsIntake.appendChild(card);
      countIntake++;
    } else if (subStatus === "Visual") {
      cardsVisual.appendChild(card);
      countVisual++;
    } else if (subStatus === "Dimensional") {
      cardsDimensional.appendChild(card);
      countDimensional++;
    } else if (subStatus === "Review") {
      cardsReview.appendChild(card);
      countReview++;
    } else if (subStatus === "Ready") {
      cardsReady.appendChild(card);
      countReady++;
    }
  });

  document.getElementById("count-intake").textContent = countIntake;
  document.getElementById("count-visual").textContent = countVisual;
  document.getElementById("count-dimensional").textContent = countDimensional;
  document.getElementById("count-review").textContent = countReview;
  document.getElementById("count-ready").textContent = countReady;

  const adminPanel = document.getElementById("admin-inspection-panel");
  if (adminPanel) {
    if (currentUser && currentUser.role !== 'operator') {
      adminPanel.style.display = "block";
      renderAdminInspectionTracking();
    } else {
      adminPanel.style.display = "none";
    }
  }
}

function renderAdminInspectionTracking() {
  const tbody = document.getElementById("admin-inspection-list");
  if (!tbody) return;
  tbody.innerHTML = "";
  
  const filterOp = document.getElementById("admin-filter-operator")?.value || "";
  const filterStat = document.getElementById("admin-filter-status")?.value || "";
  
  const filtered = inspectionMasterRecords.filter(r => {
    // Filter by Operator (case-insensitive and trimmed)
    if (filterOp) {
      const fOp = String(filterOp).trim().toUpperCase();
      const aFirst = String(r.assignedFirst || "").trim().toUpperCase();
      const aSecond = String(r.assignedSecond || "").trim().toUpperCase();
      if (aFirst !== fOp && aSecond !== fOp) return false;
    }
    
    // Filter by Status
    if (filterStat) {
      const isDel = r.status && r.status.toLowerCase() === 'delivered';
      if (filterStat === 'Delivered' && !isDel) return false;
      if (filterStat === 'Active' && isDel) return false;
    }
    return true;
  });
  
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No assignments found.</td></tr>`;
    return;
  }
  
  filtered.forEach(r => {
    const tr = document.createElement("tr");
    
    let statusClass = "badge-pending";
    if (r.status && r.status.toLowerCase() === 'delivered') {
      statusClass = "badge-completed";
    } else if (r.status && r.status.toLowerCase() === 'rework') {
      statusClass = "badge-hold";
    } else if (r.status && r.status.toLowerCase().includes("delivered")) {
      statusClass = "badge-hold"; // e.g. Half Delivered
    }
    
    // Process Google Sheets date serials or Date strings
    let lastUpdatedStr = "N/A";
    if (r.timestamp) {
      const match = r.timestamp.match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)/);
      if (match) {
        const y = match[1];
        const m = String(Number(match[2]) + 1).padStart(2, '0');
        const d = String(match[3]).padStart(2, '0');
        const h = match[4] ? String(match[4]).padStart(2, '0') : '00';
        const min = match[5] ? String(match[5]).padStart(2, '0') : '00';
        const s = match[6] ? String(match[6]).padStart(2, '0') : '00';
        lastUpdatedStr = `${y}-${m}-${d} ${h}:${min}:${s}`;
      } else {
        const d = new Date(r.timestamp);
        if (!isNaN(d.getTime())) {
          lastUpdatedStr = d.toISOString().replace('T', ' ').substring(0, 19);
        } else {
          lastUpdatedStr = r.timestamp;
        }
      }
    }
    
    tr.innerHTML = `
      <td class="font-mono font-bold text-cyan">${r.kpNo}${r.jcNo ? ` (${r.jcNo})` : ""}</td>
      <td>${r.customer}</td>
      <td>${r.partName}</td>
      <td class="font-mono">${r.quantity}</td>
      <td><span class="badge badge-normal">${r.assignedFirst || 'None'}</span></td>
      <td><span class="badge ${statusClass}">${r.status || 'N/A'}</span></td>
      <td class="font-mono" style="font-size:11px;">${lastUpdatedStr}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function approveInspectionJob(kpNumber) {
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (job) {
    const selectEl = document.getElementById(`inspect-next-stage-${kpNumber}`);
    const nextDept = selectEl ? selectEl.value : "Masking";
    
    const payload = {
      type: "END_CYCLE",
      kpNo: kpNumber,
      stage: "Inspection",
      operatorName: getLoggedUser().name,
      endTime: new Date().toISOString(),
      activeTimeMs: 0,
      nextStage: nextDept
    };
    
    // Optimistic UI mutation
    transitionToStage(job, nextDept, getLoggedUser().name);
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
        console.error("Failed to sync inspection approval to backend:", err);
        let errorMsg = "Failed to sync inspection approval: " + (err.message || err);
        if (err.message && err.message.toLowerCase().includes("permission")) {
          errorMsg = "Security Error: Missing or insufficient permissions.\n\nThis usually means your account role in the live database is still 'Operator' instead of 'Quality Admin'. Please ask the Administrator to assign you the 'Quality Admin' role in the User Profiles tab of the dashboard.";
        }
        alert(errorMsg);
        if (pendingSyncCount === 0) {
          return loadState().then(() => renderAll());
        }
      });
  }
}


// 9. TAB VIEW: MASKING DASHBOARD
function renderMaskingDashboard() {
  // Always render supervisor panel and daily summary (very fast text/numbers updates)
  renderSupervisorPanel();
  renderDailySummary();
  
  // Render subtabs selectively based on the active subtab pane
  if (activeMaskingSubtab === "masking-subtab-queue") {
    renderLiveJobQueue();
  } else if (activeMaskingSubtab === "masking-subtab-active") {
    renderActiveJobTimer();
    renderActiveJobCards();
    renderMaterialConsumption();
    renderHoldManagementPanel();
  } else if (activeMaskingSubtab === "masking-subtab-materials") {
    renderMaterialConsumption();
  } else if (activeMaskingSubtab === "masking-subtab-supervisor") {
    renderOperatorRegistry();
    renderCycleChronology();
    renderJobHistory();
  }
}