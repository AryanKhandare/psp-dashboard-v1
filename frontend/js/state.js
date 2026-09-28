// App State Variables
let jobs = [];

// Zoho Redesign state and search helper
window.globalSearchQuery = '';
window.overviewViewMode = 'list';

function getFilteredJobs(list) {
  if (!window.globalSearchQuery) return list;
  return list.filter(j => {
    const kp = (j.kpNumber || "").toLowerCase();
    const jc = (typeof getJobJcNo === 'function') ? getJobJcNo(j) : "";
    const jcStr = jc ? String(jc).toLowerCase() : "";
    const part = (j.partName || "").toLowerCase();
    const cust = (j.customer || "").toLowerCase();
    const op = (j.operatorName || "").toLowerCase();
    const status = (j.status || "").toLowerCase();
    const dept = (j.currentDepartment || "").toLowerCase();
    
    return kp.includes(window.globalSearchQuery) || 
           jcStr.includes(window.globalSearchQuery) || 
           part.includes(window.globalSearchQuery) || 
           cust.includes(window.globalSearchQuery) ||
           op.includes(window.globalSearchQuery) ||
           status.includes(window.globalSearchQuery) ||
           dept.includes(window.globalSearchQuery);
  });
}
window.getFilteredJobs = getFilteredJobs;

// Helper functions for KP cleaning and quantity splitting/history
function getCleanKpNumber(kp) {
  if (!kp) return "";
  const index = kp.indexOf("-R");
  if (index !== -1) {
    return kp.substring(0, index);
  }
  return kp;
}
window.getCleanKpNumber = getCleanKpNumber;

function renderQuantityWithHistory(job, isTable = false) {
  const qty = job.quantity;
  if (!job.qtyHistory || job.qtyHistory.length === 0) {
    return `${qty} pcs`;
  }
  
  // Format the history string, e.g. "4 done in Masking out of 10"
  const historyParts = job.qtyHistory.map(h => `${h.qty} done in ${h.stage} out of ${h.originalTotal}`);
  const historyText = `(${historyParts.join(", ")})`;
  
  if (isTable) {
    return `<span class="text-red font-bold font-mono" style="color: #ef4444 !important;">${qty} pcs</span> <small class="text-red" style="color: #ef4444 !important; display: block; font-size: 11px;">${historyText}</small>`;
  } else {
    return `<span class="text-red font-bold font-mono" style="color: #ef4444 !important;">${qty} pcs</span> <span class="text-red" style="color: #ef4444 !important; font-size: 13px; font-weight: bold; margin-left: 5px;">${historyText}</span>`;
  }
}
window.renderQuantityWithHistory = renderQuantityWithHistory;

function splitJobAndProgress(job, doneQty, nextDept, operatorName, stageName, stageData = {}) {
  const now = new Date();
  const originalQty = job.quantity;
  const restQty = originalQty - doneQty;

  let splitKp = job.kpNumber;
  if (splitKp.includes("-R")) {
    const parts = splitKp.split("-R");
    const num = parseInt(parts[1]) || 1;
    splitKp = parts[0] + "-R" + (num + 1);
  } else {
    splitKp = splitKp + "-R";
  }

  // Update history for the progressing split job
  const updatedHistory = [...(job.qtyHistory || [])];
  updatedHistory.push({
    stage: stageName,
    qty: doneQty,
    originalTotal: originalQty,
    operator: operatorName,
    timestamp: now.toISOString()
  });

  const stageKey = stageName.toLowerCase().replace(/[^a-z]/g, "");

  // Create local split job that progresses to the next stage
  const splitJob = {
    kpNumber: splitKp,
    partName: job.partName,
    customer: job.customer,
    quantity: doneQty,
    processType: job.processType,
    priority: job.priority,
    inspectionDate: job.inspectionDate || new Date().toISOString().split('T')[0],
    receivedDate: job.receivedDate || "",
    currentDepartment: nextDept,
    status: "Pending",
    operatorName: "",
    shift: "",
    qtyHistory: updatedHistory,
    splitRemark: "",
    masking: { status: "Pending", materials: [], holdHistory: [] },
    spraying: { status: "Pending" },
    grinding: { status: "Pending", holdHistory: [] },
    polishing: { status: "Pending" },
    finalInspection: { status: "Pending" },
    dispatch: { status: "Pending" }
  };

  // Populate completed stage state in the split job
  splitJob[stageKey] = Object.assign({
    status: "Completed",
    endTime: now.toISOString(),
    operatorName: operatorName
  }, stageData);

  // Copy other completed stages from the original job to the split job
  const stages = ["masking", "spraying", "grinding", "polishing", "finalInspection", "dispatch"];
  stages.forEach(st => {
    if (st !== stageKey && job[st] && job[st].status === "Completed") {
      splitJob[st] = JSON.parse(JSON.stringify(job[st]));
    }
  });

  // Mutate original job locally to hold the remaining pending parts
  job.quantity = restQty;
  // qtyHistory remains unchanged for the remaining pending parts
  
  // Set current stage to Pending with splitRemark for original job
  job.currentDepartment = stageName;
  job.status = "Pending";
  job.operatorName = "";
  job.shift = "";
  job.splitRemark = `${doneQty}/${originalQty} done → ${nextDept}. Remaining: ${restQty} pending.`;
  
  job[stageKey] = {
    status: "Pending",
    holdHistory: []
  };
  if (stageKey === "masking") {
    job[stageKey].materials = [];
  } else if (stageKey === "grinding") {
    job[stageKey].processType = "";
    job[stageKey].machineName = "";
    job[stageKey].storeLocation = "";
    job[stageKey].quantity = restQty;
    job[stageKey].durationMs = 0;
    job[stageKey].activeTimeMs = 0;
  } else if (stageKey === "spraying") {
    job[stageKey].batchId = "";
    job[stageKey].processedQty = 0;
    job[stageKey].totalPasses = 0;
    job[stageKey].finalTemp = "";
    job[stageKey].finalThickness = "";
    job[stageKey].finalSize = "";
    job[stageKey].powderConsumed = "";
    job[stageKey].durationMs = 0;
    job[stageKey].activeTimeMs = 0;
  }

  // Push to local jobs
  jobs.push(splitJob);

  // Prepare payload for Firestore
  const payload = {
    type: "SPLIT_STAGE",
    kpNo: job.kpNumber,
    splitKp: splitKp,
    stage: stageName,
    doneQty: doneQty,
    restQty: restQty,
    operatorName: operatorName,
    endTime: now.toISOString(),
    nextStage: nextDept,
    qtyHistory: updatedHistory,
    stageData: stageData
  };

  return payload;
}
window.splitJobAndProgress = splitJobAndProgress;

// Expose jobs on window so iframes (spraying.html) can read via window.parent.jobs
Object.defineProperty(window, 'jobs', {
  get: () => jobs,
  set: (val) => { jobs = val; },
  configurable: true
});
let operators = [];
window.sprayingJobActive = false;
let materials = [];
let auditLogs = [];
let users = [];
let machines = [];
let selectedJobKp = null;
let timerIntervalId = null;
let activeMaskingSubtab = "masking-subtab-queue"; // Default sub-tab
let activeSprayingSubtab = "spraying-subtab-queue"; // Default spraying sub-tab
let activeGrindingSubtab = "grinding-subtab-queue"; // Default grinding sub-tab
let activeDmdSubtab = "dmd-subtab-health"; // Default DMD sub-tab
let selectedSprayingJobKp = null; // Spraying active job selection state
let selectedOperatorName = null; // Operator modal selection state
let selectedShiftName = "A Shift"; // Shift modal selection state
let selectedHoldReason = null; // Hold Reason touch select state
let selectedGrindingJobKp = null; // Grinding active job selection state
let firestoreListeners = []; // Firestore listener unsubscribe handles
let _initialFirestoreLoadComplete = false; // Flag to prevent auto-sync before Firestore load complete

// Logged In User State
let currentUser = null;
let pendingSyncCount = 0;
const materialSyncTimers = {};

const scriptUrl = "https://script.google.com/macros/s/AKfycbzCxwxRMklpjhIqNfTC2acu75Rb8-RHxo2_mK5kF-gBr8pnk2tAwB3G1_Mc-Ff779RfXQ/exec";
window.scriptUrl = scriptUrl;

let _stateFetchInProgress = false;

async function loadState() {
  if (!isMockMode()) {
    return;
  }
  
  // If we have cached jobs in localStorage, load them and skip the network fetch in Mock Mode
  const cachedJobsStr = localStorage.getItem("psp_cached_jobs");
  if (cachedJobsStr) {
    try {
      const cachedJobs = JSON.parse(cachedJobsStr);
      if (Array.isArray(cachedJobs) && cachedJobs.length > 0) {
        jobs = cachedJobs;
        console.log("[loadState] Restored jobs from local storage cache in Mock/Offline Mode.");
        
        const cachedUsers = localStorage.getItem("psp_cached_users");
        if (cachedUsers) users = JSON.parse(cachedUsers);
        const cachedOperators = localStorage.getItem("psp_cached_operators");
        if (cachedOperators) operators = JSON.parse(cachedOperators);
        const cachedMaterials = localStorage.getItem("psp_cached_materials");
        if (cachedMaterials) materials = JSON.parse(cachedMaterials);
        const cachedAudit = localStorage.getItem("psp_cached_audit_logs");
        if (cachedAudit) auditLogs = JSON.parse(cachedAudit);
        
        _stateFetchInProgress = false;
        renderAll();
        return;
      }
    } catch (e) {
      console.warn("[loadState] Failed to restore jobs from cache, falling back to Sheets:", e);
    }
  }

  if (_stateFetchInProgress) {
    console.log("[State] Fetch already in progress — ignoring concurrent request.");
    return;
  }
  _stateFetchInProgress = true;
  try {
    const [jobsRes, operatorsRes, materialsRes, auditLogsRes] = await Promise.all([
      fetch(scriptUrl + "?action=getJobs").then(r => r.json()),
      fetch(scriptUrl + "?action=getOperators").then(r => r.json()),
      fetch(scriptUrl + "?action=getMaterials").then(r => r.json()),
      fetch(scriptUrl + "?action=getAuditLogs").then(r => r.json())
    ]);

    console.log("RAW JOBS RES:", JSON.stringify(jobsRes));

    if (Array.isArray(operatorsRes) && operatorsRes.length > 0) {
      operators = operatorsRes;
    } else {
      operators = [...SEED_OPERATORS];
    }
    if (Array.isArray(materialsRes) && materialsRes.length > 0) {
      materials = materialsRes;
    } else {
      materials = [...SEED_MATERIALS];
    }

    if (Array.isArray(jobsRes)) {
      jobs = jobsRes.map(j => {
        const mapped = {
          kpNumber: j.kpNumber || j.kpNo || j.ID || j.jobId || "",
          partName: j.partName || j.PartName || j["Part Name"] || j.Part || j.part || "Unknown Part",
          customer: j.customer || j.Customer || j.customerName || j.CustomerName || j["Customer Name"] || "Unknown Customer",
          quantity: Number(j.quantity || j.qty || j.Qty || 1),
          processType: j.processType || j.process || j["Process Type"] || "Plasma",
          priority: j.priority || "Normal",
          inspectionDate: j.inspectionDate || new Date().toISOString().split('T')[0],
          receivedDate: j.receivedDate || "",
          plannedCompletionDate: j.plannedCompletionDate || "",
          stageAssignedAt: j.stageAssignedAt || {},
          currentDepartment: j.currentDepartment || j.department || j.CurrentDepartment || "Inspection",
          status: j.status || j.Status || "Pending",
          operatorName: j.operatorName || j.operator || "",
          shift: j.shift || "",
          masking: j.masking || { status: "Pending", materials: [], holdHistory: [] },
          spraying: j.spraying || { status: "Pending" },
          grinding: j.grinding || { status: "Pending" },
          polishing: j.polishing || { status: "Pending" },
          finalInspection: j.finalInspection || { status: "Pending" },
          dispatch: j.dispatch || { status: "Pending" },
          jcNo: j.jcNo || j.jcNumber || j.jcno || ""
        };
        if (!mapped.jcNo && window.kpToJcMap && mapped.kpNumber && window.kpToJcMap[mapped.kpNumber.toUpperCase()]) {
          mapped.jcNo = window.kpToJcMap[mapped.kpNumber.toUpperCase()];
        }
        
        mapped.masking = mapped.masking || { status: "Pending", materials: [], holdHistory: [] };
        if (mapped.currentDepartment === "Masking") {
          if (!mapped.masking.materials || mapped.masking.materials.length === 0) {
            mapped.masking.materials = [
              { name: "Masking Tape", type: "Tape", batch: "MT-2026-06", unit: "KG", plannedQty: mapped.quantity, actualQty: 0 },
              { name: "High Temperature Putty", type: "Sealant", batch: "HTP-9921", unit: "Gram", plannedQty: 350, actualQty: 0 }
            ];
          } else {
            mapped.masking.materials.forEach(mat => {
              const matchedMat = materials.find(m => m.name.toLowerCase() === mat.name.toLowerCase());
              if (matchedMat) {
                if (!mat.type) mat.type = matchedMat.type;
                if (!mat.unit) mat.unit = matchedMat.unit;
                if (!mat.plannedQty || mat.plannedQty === 0) mat.plannedQty = matchedMat.plannedQty;
              }
            });
          }
        }
        mapped.spraying = mapped.spraying || { status: "Pending" };
        mapped.grinding = mapped.grinding || { status: "Pending", holdHistory: [] };
        mapped.grinding.status = mapped.grinding.status || "Pending";
        mapped.grinding.processType = mapped.grinding.processType || "";
        mapped.grinding.machineName = mapped.grinding.machineName || "";
        mapped.grinding.storeLocation = mapped.grinding.storeLocation || "";
        mapped.grinding.quantity = Number(mapped.grinding.quantity || mapped.quantity);
        mapped.grinding.startTime = mapped.grinding.startTime || null;
        mapped.grinding.endTime = mapped.grinding.endTime || null;
        mapped.grinding.durationMs = Number(mapped.grinding.durationMs || 0);
        mapped.grinding.activeTimeMs = Number(mapped.grinding.activeTimeMs || 0);
        mapped.grinding.lastStartedAt = mapped.grinding.lastStartedAt || null;
        mapped.grinding.lastPausedAt = mapped.grinding.lastPausedAt || null;
        mapped.grinding.holdHistory = mapped.grinding.holdHistory || [];
        mapped.grinding.operatorName = mapped.grinding.operatorName || "";
        mapped.grinding.remarks = mapped.grinding.remarks || "";
        mapped.grinding.qualityRemarks = mapped.grinding.qualityRemarks || "";
        mapped.grinding.notes = mapped.grinding.notes || "";
        
        mapped.polishing = mapped.polishing || { status: "Pending" };
        mapped.finalInspection = mapped.finalInspection || { status: "Pending" };
        mapped.dispatch = mapped.dispatch || { status: "Pending" };
        
        return mapped;
      });
    }
    if (Array.isArray(auditLogsRes)) {
      auditLogs = auditLogsRes
        .map(l => ({
          timestamp: l.timestamp || l.Time || l.Date || new Date().toISOString(),
          user: l.user || l.operator || l.Username || l.User || "System",
          role: l.role || "Operator",
          department: l.department || l.stage || l.Department || "Masking",
          kpNumber: l.kpNumber || l.kpNo || l.kpnumber || l.jobId || "N/A",
          action: l.action || l.Action || l.details || l.Details || "Event"
        }))
        .filter(l => l.action !== "Event" || l.user !== "System");
    } else {
      auditLogs = [];
    }
    try {
      localStorage.setItem("psp_cached_jobs", JSON.stringify(jobs));
      localStorage.setItem("psp_cached_users", JSON.stringify(users));
      localStorage.setItem("psp_cached_operators", JSON.stringify(operators));
      localStorage.setItem("psp_cached_materials", JSON.stringify(materials));
      localStorage.setItem("psp_cached_audit_logs", JSON.stringify(auditLogs));
    } catch (e) {}
    console.log("State loaded successfully from Sheets backend.");
  } catch (err) {
    console.warn("Could not load state from backend (offline?):", err);
    if (!jobs || jobs.length === 0) {
      jobs = SEED_JOBS.map(j => {
        const copy = JSON.parse(JSON.stringify(j));
        return copy;
      });
      operators = [...SEED_OPERATORS];
      materials = [...SEED_MATERIALS];
      auditLogs = [...SEED_AUDIT_LOGS];
    }
  } finally {
    _stateFetchInProgress = false;
  }
}

function saveState() {
  try {
    localStorage.setItem("psp_cached_jobs", JSON.stringify(jobs));
  } catch (e) {
    console.warn("Failed to save local state:", e);
  }
}


function resetData() {
  if (confirm("Are you sure you want to reset all shop floor data to defaults? This clears all active timers and custom entries.")) {
    const isMock = localStorage.getItem("psp_auth_mock");
    localStorage.clear();
    if (isMock !== null) {
      localStorage.setItem("psp_auth_mock", isMock);
    }
    location.reload();
  }
}

// 2. LIVE CLOCK (updates header timestamp)
function startClock() {
  updateClock();
  setInterval(updateClock, 1000);
}