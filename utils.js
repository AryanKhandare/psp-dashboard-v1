
/**
 * Returns urgency level: "normal" | "warning" | "critical" | "unknown"
 */
function getTATUrgency(job) {
  const pct = calcTATPct(job);
  if (pct < 0) return "unknown";
  if (pct >= 80) return "critical";
  if (pct >= 50) return "warning";
  return "normal";
}

/**
 * Returns an object with detailed TAT info for display
 */
function getTATDaysInfo(job) {
  if (!job.inspectionDate || !job.plannedCompletionDate) {
    return { totalDays: 0, elapsedDays: 0, remainingDays: 0, pct: -1, urgency: "unknown" };
  }
  const start = new Date(job.inspectionDate);
  const end = new Date(job.plannedCompletionDate);
  const now = new Date();
  const totalDays = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
  const elapsedDays = Math.max(0, Math.ceil((now - start) / (1000 * 60 * 60 * 24)));
  const remainingDays = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
  const pct = calcTATPct(job);
  return { totalDays, elapsedDays, remainingDays, pct, urgency: getTATUrgency(job) };
}

/**
 * Build TAT chip HTML to embed into a card
 */
function buildTATChipHTML(job) {
  const info = getTATDaysInfo(job);

  let chipColor = '#3b82f6'; // blue
  let chipBg = 'rgba(59,130,246,0.12)';
  let chipBorder = 'rgba(59,130,246,0.35)';
  let icon = '⏱';
  let labelText = '';

  if (info.pct < 0) {
    labelText = 'Details';
  } else {
    labelText = `${info.remainingDays}d left`;
    if (info.urgency === 'warning') {
      chipColor = '#eab308';
      chipBg = 'rgba(234,179,8,0.12)';
      chipBorder = 'rgba(234,179,8,0.4)';
      icon = '⚠️';
    } else if (info.urgency === 'critical') {
      chipColor = '#ef4444';
      chipBg = 'rgba(239,68,68,0.15)';
      chipBorder = 'rgba(239,68,68,0.45)';
      icon = '🔴';
    }
  }

  return `<span class="tat-chip" onclick="event.stopPropagation();showTATPopup('${job.kpNumber}')" style="cursor:pointer;display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:${chipBg};color:${chipColor};border:1px solid ${chipBorder};white-space:nowrap;" title="TAT: Click to view details">${icon} ${labelText}</span>`;
}

/**
 * Show TAT popup modal for a specific job
 */
function showTATPopup(kpNumber) {
  const job = jobs.find(j => j.kpNumber === kpNumber);
  if (!job) return;

  const info = getTATDaysInfo(job);
  const stageAssigned = job.stageAssignedAt || {};

  // Build stage timeline rows
  const stages = ['masking', 'spraying', 'grinding', 'polishing'];
  const stageLabels = { masking: 'Masking', spraying: 'Spraying', grinding: 'Grinding', polishing: 'Polishing' };
  let timelineHTML = '';
  stages.forEach(st => {
    const ts = stageAssigned[st];
    const label = stageLabels[st];
    const isCurrent = job.currentDepartment && job.currentDepartment.toLowerCase() === st;
    const dotColor = ts ? (isCurrent ? '#38bdf8' : '#10b981') : '#475569';
    const dateStr = ts ? new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    timelineHTML += `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0;">
        <div style="width:10px;height:10px;border-radius:50%;background:${dotColor};flex-shrink:0;${isCurrent ? 'box-shadow:0 0 8px ' + dotColor + ';' : ''}"></div>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:12px;color:${isCurrent ? '#38bdf8' : '#e2e8f0'};">${label} ${isCurrent ? '(Current)' : ''}</div>
          <div style="font-size:11px;color:#94a3b8;">${dateStr}</div>
        </div>
      </div>`;
  });

  // Progress bar
  const barPct = Math.min(info.pct, 100);
  let barColor = '#3b82f6';
  if (info.urgency === 'warning') barColor = '#eab308';
  if (info.urgency === 'critical') barColor = '#ef4444';

  const inspDateStr = job.inspectionDate ? new Date(job.inspectionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const compDateStr = job.plannedCompletionDate ? new Date(job.plannedCompletionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const modal = document.getElementById('tat-popup-modal');
  if (!modal) return;

  modal.querySelector('.tat-popup-content').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 style="margin:0;font-size:16px;font-weight:800;color:#38bdf8;font-family:var(--font-mono);">${getCleanKpNumber(job.kpNumber)}</h3>
      <button onclick="closeTATPopup()" style="background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer;padding:4px;">&times;</button>
    </div>

    <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:16px;">
      <div style="flex:1;padding:10px;border-radius:8px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);text-align:center;">
        <div style="font-size:10px;color:#94a3b8;margin-bottom:4px;">Inspection Arrival</div>
        <div style="font-size:13px;font-weight:700;color:#60a5fa;">${inspDateStr}</div>
      </div>
      <div style="flex:1;padding:10px;border-radius:8px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);text-align:center;">
        <div style="font-size:10px;color:#94a3b8;margin-bottom:4px;">Planned Completion</div>
        <div style="font-size:13px;font-weight:700;color:#f87171;">${compDateStr}</div>
      </div>
    </div>

    <div style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span style="font-size:11px;color:#94a3b8;">${info.elapsedDays} of ${info.totalDays} days elapsed</span>
        <span style="font-size:11px;font-weight:700;color:${barColor};">${info.remainingDays} days remaining</span>
      </div>
      <div style="width:100%;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden;">
        <div style="width:${barPct}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.5s ease;"></div>
      </div>
      <div style="text-align:center;margin-top:4px;font-size:10px;font-weight:700;color:${barColor};">${info.pct}% elapsed</div>
    </div>

    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:12px;">
      <div style="font-size:11px;font-weight:700;color:#e2e8f0;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">Stage Timeline</div>
      ${timelineHTML}
    </div>
  `;
  modal.style.display = 'flex';
}
window.showTATPopup = showTATPopup;

function closeTATPopup() {
  const modal = document.getElementById('tat-popup-modal');
  if (modal) modal.style.display = 'none';
}
window.closeTATPopup = closeTATPopup;

// ── OPERATOR ROUTING & RESPONSE TIME LIMITS ──

let _forwardCheckTicks = 0;

function getStageStartLimitMs(deptName) {
  const cleanDept = deptName.trim().toLowerCase();
  if (cleanDept === "masking") return 4 * 60 * 60 * 1000;   // 4 hours
  if (cleanDept === "spraying") return 24 * 60 * 60 * 1000; // 24 hours
  return null; // Don't assign time limit for grinding, polishing, etc.
}

function getOperatorsForDepartment(deptName) {
  const cleanDept = deptName.trim().toLowerCase();
  // Filter registered users who are operators in this department
  const allUsers = (typeof users !== "undefined" && Array.isArray(users)) ? users : [];
  let deptOps = allUsers
    .filter(u => u.role === "operator" && u.department && u.department.trim().toLowerCase() === cleanDept)
    .map(u => u.name || u.email.split("@")[0]);

  if (deptOps.length === 0) {
    if (cleanDept === "masking") return ["Sameer", "Tripati", "SJ", "DN", "Vikrant"];
    if (cleanDept === "spraying") return ["GN", "Vikrant", "TJ"];
    if (cleanDept === "grinding") return ["Dhuryodhan", "Vikrant"];
    if (cleanDept === "polishing") return ["Polishing Operator", "Vikrant"];
    return ["Operator"];
  }
  return deptOps;
}

function getNextOperatorForDepartment(currentOpName, deptName) {
  const ops = getOperatorsForDepartment(deptName);
  if (ops.length === 0) return "";
  if (!currentOpName) return ops[0];
  const cleanCurrent = currentOpName.trim().toLowerCase();
  const index = ops.findIndex(name => name.trim().toLowerCase() === cleanCurrent);
  if (index === -1) return ops[0];
  return ops[(index + 1) % ops.length];
}

function getNextRoundRobinOperator(deptName) {
  const ops = getOperatorsForDepartment(deptName);
  if (ops.length === 0) return "";
  const cleanDept = deptName.toLowerCase().replace(/[^a-z]/g, "");
  const counts = {};
  ops.forEach(op => counts[op.toLowerCase()] = 0);
  
  if (Array.isArray(jobs)) {
    jobs.forEach(j => {
      if (j.currentDepartment.toLowerCase().replace(/[^a-z]/g, "") === cleanDept) {
        const opName = (j[cleanDept] && j[cleanDept].operatorName) || "";
        if (opName && counts[opName.toLowerCase()] !== undefined) {
          counts[opName.toLowerCase()]++;
        }
      }
    });
  }

  let minOp = ops[0];
  let minCount = Infinity;
  ops.forEach(op => {
    if (counts[op.toLowerCase()] < minCount) {
      minCount = counts[op.toLowerCase()];
      minOp = op;
    }
  });
  return minOp;
}

function autoAssignPendingJobs() {
  const prodStages = ["Masking", "Spraying", "Grinding", "Polishing"];
  let updated = false;
  if (!Array.isArray(jobs)) return;
  
  jobs.forEach(job => {
    if (prodStages.includes(job.currentDepartment)) {
      const stageKey = job.currentDepartment.toLowerCase().replace(/[^a-z]/g, "");
      if (job[stageKey]) {
        const currentOp = (job[stageKey].operatorName || "").trim();
        const validOps = getOperatorsForDepartment(job.currentDepartment);
        
        const isGenericOrInvalid = !currentOp || 
          currentOp.toLowerCase() === "masking" || 
          currentOp.toLowerCase() === "spraying" || 
          currentOp.toLowerCase() === "grinding" || 
          currentOp.toLowerCase() === "polishing" || 
          currentOp.toLowerCase() === "operator" ||
          !validOps.some(op => op.toLowerCase() === currentOp.toLowerCase());

        if (isGenericOrInvalid) {
          const assignedOp = getNextRoundRobinOperator(job.currentDepartment);
          if (assignedOp && assignedOp !== currentOp) {
            job[stageKey].operatorName = assignedOp;
            job.stageAssignedAt = job.stageAssignedAt || {};
            if (!job.stageAssignedAt[stageKey]) {
              job.stageAssignedAt[stageKey] = new Date().toISOString();
            }
            // Sync queueEntryTime for weekly reports
            job[stageKey].queueEntryTime = job.stageAssignedAt[stageKey];
            updated = true;
            if (!isMockMode() && job.id) {
              const db = firebase.firestore();
              const updates = {};
              updates[`${stageKey}.operatorName`] = assignedOp;
              updates[`stageAssignedAt.${stageKey}`] = job.stageAssignedAt[stageKey];
              updates[`${stageKey}.queueEntryTime`] = job.stageAssignedAt[stageKey];
              db.collection("jobs").doc(job.id).update(updates).catch(e => console.error("Firestore auto-assign err:", e));
            }
          }
        }
      }
    }
  });
  if (updated && isMockMode()) saveState();
}

function recordLateStartPenalty(operatorName, department, kpNo) {
  const allUsers = (typeof users !== "undefined" && Array.isArray(users)) ? users : [];
  const targetUser = allUsers.find(u => {
    const cleanName = (u.name || "").trim().toLowerCase();
    const cleanEmail = (u.email || "").split("@")[0].trim().toLowerCase();
    const cleanOp = operatorName.trim().toLowerCase();
    return cleanName === cleanOp || cleanEmail === cleanOp;
  });

  if (!targetUser) return;
  const currentPenalties = Number(targetUser.lateStartPenalties || 0) + 1;
  targetUser.lateStartPenalties = currentPenalties;

  if (!isMockMode() && targetUser.uid) {
    const db = firebase.firestore();
    db.collection("users").doc(targetUser.uid).update({ lateStartPenalties: currentPenalties }).catch(e => console.error("Firestore user penalty update err:", e));
  } else {
    saveState();
  }
}

function buildCardArrivalTimerHTML(job) {
  const prodStages = ["Masking", "Spraying", "Grinding", "Polishing"];
  if (!prodStages.includes(job.currentDepartment)) return "";
  const stageKey = job.currentDepartment.toLowerCase().replace(/[^a-z]/g, "");
  return `
    <div class="tat-countdown-container" data-kp="${job.kpNumber}" style="margin-top: 8px;">
      <div style="font-size: 11px; display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed rgba(255, 255, 255, 0.08); padding-top: 6px;">
        <span class="tat-timer-label" style="color: var(--text-label);">Arrived: --:--</span>
        <span class="tat-timer-value" style="color: var(--text-muted);">⏱ Loading...</span>
      </div>
    </div>
  `;
}

function buildDeleteJobButtonHTML(kpNumber) {
  if (!currentUser) return "";
  const isAdmin = ["super_admin", "production_admin", "it_team"].includes(currentUser.role);
  if (!isAdmin) return "";
  return `<button class="btn btn-danger btn-xs" style="width:100%; height:28px; font-size:11px; margin-top:4px; opacity:0.85;" onclick="event.stopPropagation(); deleteJob('${kpNumber}')">🗑️ Delete Job</button>`;
}

/**
 * Check TAT alerts for all production-stage jobs (called from renderAll)
 * Fires a one-time red alert toast per session for critical jobs
 */
function checkTATAlerts() {
  const prodStages = ['Masking', 'Spraying', 'Grinding', 'Polishing'];
  jobs.forEach(job => {
    if (!prodStages.includes(job.currentDepartment)) return;
    if (_tatAlertedJobs.has(job.kpNumber)) return;
    const urgency = getTATUrgency(job);
    if (urgency === 'critical') {
      _tatAlertedJobs.add(job.kpNumber);
      const info = getTATDaysInfo(job);
      if (typeof showToast === 'function') {
        showToast(`⚠️ TAT CRITICAL: ${getCleanKpNumber(job.kpNumber)}`, `Only ${info.remainingDays} day(s) left! Completion deadline: ${job.plannedCompletionDate}`, 'error', 8000);
      }
    }
  });
}


// Dynamic Google Sheet Master Data integration for Inspection Stage
let colMapping = {
  kp: null,
  customer: null,
  partName: null,
  quantity: null,
  status: null,
  assignedFirst: null,
  assignedSecond: null,
  timestamp: null
};

function getOperatorCode(email) {
  if (!email) return "";
  const prefix = email.split('@')[0].toLowerCase();
  if (prefix === 'laxmi') return 'Laxmi';
  return prefix.toUpperCase();
}
let activeInspectionRecord = null;
let oeeLastTickTime = Date.now();

function getOeeStorageKey(dept) {
  if (!currentUser) return null;
  const dateStr = new Date().toISOString().split('T')[0];
  return `psp_oee_${dept.toLowerCase()}_${currentUser.email}_${dateStr}`;
}

let oeeMemoryCache = {};

function loadOeeState(dept) {
  const dKey = dept.toLowerCase();
  if (oeeMemoryCache[dKey]) {
    return oeeMemoryCache[dKey];
  }
  
  const key = getOeeStorageKey(dept);
  if (!key) return { noWork: 0, idle: 0, active: 0 };
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      oeeMemoryCache[dKey] = parsed;
      return parsed;
    } catch (e) {}
  }
  const defaultState = { noWork: 0, idle: 0, active: 0 };
  oeeMemoryCache[dKey] = defaultState;
  return defaultState;
}

function saveOeeState(dept, state, persistImmediately = false) {
  const dKey = dept.toLowerCase();
  oeeMemoryCache[dKey] = state;
  
  if (persistImmediately) {
    const key = getOeeStorageKey(dept);
    if (key) {
      localStorage.setItem(key, JSON.stringify(state));
    }
  }
}

function persistOeeCacheToLocalStorage() {
  ["Masking", "Spraying", "Grinding", "Polishing"].forEach(dept => {
    const dKey = dept.toLowerCase();
    if (oeeMemoryCache[dKey]) {
      const key = getOeeStorageKey(dept);
      if (key) {
        localStorage.setItem(key, JSON.stringify(oeeMemoryCache[dKey]));
      }
    }
  });
}

// Persist on tab close or page hide to prevent data loss
window.addEventListener("beforeunload", () => {
  persistOeeCacheToLocalStorage();
});
window.addEventListener("pagehide", () => {
  persistOeeCacheToLocalStorage();
});

function updateSystemOnlineStatus() {
  const dot = document.querySelector(".indicator-dot");
  const text = document.querySelector(".indicator-text");
  if (!dot || !text) return;
  
  if (isMockMode()) {
    dot.className = "indicator-dot hold";
    dot.style.background = "#eab308";
    text.textContent = "OFFLINE FALLBACK MODE";
    text.style.color = "#eab308";
  } else {
    dot.className = "indicator-dot online";
    dot.style.background = "#10b981";
    text.textContent = "SHOP FLOOR ONLINE";
    text.style.color = "";
  }
}

function updateOeeUi(dept, state, mode) {
  const oeeValEl = document.getElementById(`${dept.toLowerCase()}-oee-val-oee`);
  const noworkValEl = document.getElementById(`${dept.toLowerCase()}-oee-val-nowork`);
  const idleValEl = document.getElementById(`${dept.toLowerCase()}-oee-val-idle`);
  const activeValEl = document.getElementById(`${dept.toLowerCase()}-oee-val-active`);

  if (!oeeValEl) return;

  const total = state.noWork + state.idle + state.active;
  const oee = total === 0 ? 0 : ((state.active / total) * 100).toFixed(1);

  oeeValEl.textContent = `${oee}%`;
  noworkValEl.textContent = formatDuration(state.noWork * 1000);
  idleValEl.textContent = formatDuration(state.idle * 1000);
  activeValEl.textContent = formatDuration(state.active * 1000);

  const noworkCard = document.getElementById(`${dept.toLowerCase()}-oee-card-nowork`);
  const idleCard = document.getElementById(`${dept.toLowerCase()}-oee-card-idle`);
  const activeCard = document.getElementById(`${dept.toLowerCase()}-oee-card-active`);

  if (noworkCard) noworkCard.classList.toggle("active", mode === "NOWORK");
  if (idleCard) idleCard.classList.toggle("active", mode === "IDLE");
  if (activeCard) activeCard.classList.toggle("active", mode === "ACTIVE");
}


async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 1500 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// Configurable cache refresh interval: 10 minutes
const INSPECTION_REFRESH_INTERVAL_MS = 120000; // Poll sheet mapping every 2 minutes
let lastInspectionFetchTime = 0;

// Inline worker script to parse and filter rows on a background thread
const parserWorkerCode = `
  self.onmessage = function(e) {
    const { rows, op } = e.data;
    try {
      const records = rows.map(row => {
        const cols = row.c || [];
        
        const cleanDate = (col) => {
          if (!col) return "";
          let val = col.v;
          // GViz JSONP responses evaluate dates as JS Date objects under-the-hood
          if (val && (val instanceof Date || Object.prototype.toString.call(val) === '[object Date]')) {
            const y = val.getFullYear();
            const m = String(val.getMonth() + 1).padStart(2, '0');
            const d = String(val.getDate()).padStart(2, '0');
            return y + "-" + m + "-" + d;
          }
          let strVal = col.f || col.v;
          if (strVal === undefined || strVal === null) return "";
          strVal = String(strVal).trim();
          if (strVal.startsWith("Date(")) {
            try {
              const parts = strVal.replace("Date(", "").replace(")", "").split(",").map(Number);
              if (parts.length >= 3) {
                // GViz months are 0-indexed
                const d = new Date(parts[0], parts[1], parts[2]);
                if (!isNaN(d.getTime())) {
                  return d.toISOString().split('T')[0];
                }
              }
            } catch(e) {}
          }
          const d = new Date(strVal);
          if (!isNaN(d.getTime())) {
            return d.toISOString().split('T')[0];
          }
          return strVal;
        };

        const kpVal      = cols[0] ? String(cols[0].v ?? "").trim() : "";
        const customer   = cols[1] ? String(cols[1].v ?? "").trim() : "";
        const partName   = cols[2] ? String(cols[2].v ?? "").trim() : "";
        const quantity   = cols[3] ? String(cols[3].v ?? "").trim() : "";
        const status     = cols[4] ? String(cols[4].v ?? "").trim() : "";
        const assignedRaw= cols[5] ? String(cols[5].v ?? "").trim() : "";
        const timestamp  = cols[6] ? String(cols[6].v ?? "").trim() : "";
        const actualVal  = cols[7] ? String(cols[7].v || "").trim() : "";
        const statusYVal = cols[8] ? String(cols[8].v || "").trim() : "";
        const jcNo       = cols[9] ? String(cols[9].v || "").trim() : "";
        const firStVal   = cols[10] ? String(cols[10].v || "").trim() : "";
        const processTypeVal = cols[11] ? String(cols[11].v || "").trim() : "";
        const inspectionDate = cleanDate(cols[12]);
        const plannedCompletionDate = cleanDate(cols[13]);

        let assignedFirst = "", assignedSecond = "";
        if (assignedRaw) {
          const parts = assignedRaw.split("/").map(s => s.trim());
          assignedFirst  = parts[0] || "";
          assignedSecond = parts[1] || "";
        }

        return { 
          kpNo: kpVal, 
          customer, 
          partName, 
          quantity, 
          status, 
          assignedFirst, 
          assignedSecond, 
          timestamp, 
          actual: actualVal, 
          statusY: statusYVal, 
          jcNo, 
          firSt: firStVal, 
          processType: processTypeVal,
          inspectionDate,
          plannedCompletionDate
        };
      }).filter(r => r.kpNo && /^kp-/i.test(r.kpNo));

      let filtered = records;
      if (op) {
        const upperOp = op.trim().toUpperCase();
        filtered = records.filter(r => {
          const a1 = String(r.assignedFirst  || "").trim().toUpperCase();
          const a2 = String(r.assignedSecond || "").trim().toUpperCase();
          return a1 === upperOp || a2 === upperOp;
        });
      }
      self.postMessage({ success: true, records: filtered });
    } catch(err) {
      self.postMessage({ success: false, error: err.message });
    }
  };
`;

// Helper: Parse rows using background Worker
function parseRowsWithWorker(rows, op) {
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([parserWorkerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);
      
      worker.onmessage = function(e) {
        URL.revokeObjectURL(workerUrl);
        worker.terminate();
        if (e.data.success) {
          resolve(e.data.records);
        } else {
          reject(new Error(e.data.error));
        }
      };
      
      worker.onerror = function(err) {
        URL.revokeObjectURL(workerUrl);
        worker.terminate();
        reject(err);
      };
      
      worker.postMessage({ rows, op });
    } catch(err) {
      reject(err);
    }
  });
}

async function autoSyncJobsFromSpreadsheet(records) {
  if (isMockMode()) return;
  if (!isMockMode() && !_initialFirestoreLoadComplete) {
    console.log("[Auto-Sync] Skipping auto-sync on startup because initial Firestore snapshot is not yet loaded.");
    return;
  }
  window.autoImportedKPs = window.autoImportedKPs || new Set();
  window.deletedJobs = window.deletedJobs || new Set();
  let anyChange = false;
  
  // Build a Map of existing jobs by kpNumber for fast O(1) lookups
  const jobsMap = new Map();
  if (Array.isArray(jobs)) {
    jobs.forEach(j => {
      if (j.kpNumber) {
        jobsMap.set(j.kpNumber.toLowerCase(), j);
      }
    });
  }
  
  for (const record of records) {
    const kpNo = record.kpNo;
    if (!kpNo) continue;
    
    // Skip if job is explicitly deleted
    if (window.deletedJobs.has(kpNo.toLowerCase())) {
      continue;
    }
    
    // Determine target stage:
    // If Column Y (Status) is NOT "done", target department is "Inspection".
    // If Column Y (Status) is "done":
    //   If Column AM (FIR ST) is NOT "done", target department is "Masking".
    //   If Column AM (FIR ST) is "done" (both are done), target department is "Final Inspection".
    // SPECIAL BYPASS: If part matches shouldBypassMasking, target department is "Spraying" instead of "Masking".
    const statusYDone = record.statusY && record.statusY.trim().toLowerCase() === "done";
    const firStDone = record.firSt && record.firSt.trim().toLowerCase() === "done";
    
    let targetDept = "Inspection";
    if (statusYDone) {
      if (firStDone) {
        targetDept = "Final Inspection";
      } else {
        if (shouldBypassMasking(record.partName)) {
          targetDept = "Spraying";
        } else {
          targetDept = "Masking";
        }
      }
    }
    
    // Check if the job already exists in local list
    const existingJob = jobsMap.get(kpNo.toLowerCase());
    
    if (existingJob) {
      // Sync quantity and metadata if they differ from spreadsheet
      let fieldsChanged = false;
      const updates = {};
      const newQty = Number(record.quantity) || 1;

      if (newQty !== existingJob.quantity) {
        console.log(`[Auto-Sync] Job ${kpNo} quantity mismatch: local=${existingJob.quantity}, sheet=${newQty}. Updating...`);
        existingJob.quantity = newQty;
        updates.quantity = newQty;
        fieldsChanged = true;
      }
      if (record.partName && record.partName !== existingJob.partName) {
        existingJob.partName = record.partName;
        updates.partName = record.partName;
        fieldsChanged = true;
      }
      if (record.customer && record.customer !== existingJob.customer) {
        existingJob.customer = record.customer;
        updates.customer = record.customer;
        fieldsChanged = true;
      }
      if (record.jcNo && record.jcNo !== existingJob.jcNo) {
        existingJob.jcNo = record.jcNo;
        updates.jcNo = record.jcNo;
        fieldsChanged = true;
      }
      if (record.processType && record.processType !== existingJob.processType) {
        console.log(`[Auto-Sync] Job ${kpNo} processType mismatch: local=${existingJob.processType}, sheet=${record.processType}. Updating...`);
        existingJob.processType = record.processType;
        updates.processType = record.processType;
        fieldsChanged = true;
      }
      if (record.inspectionDate && record.inspectionDate !== existingJob.inspectionDate) {
        existingJob.inspectionDate = record.inspectionDate;
        updates.inspectionDate = record.inspectionDate;
        fieldsChanged = true;
      }
      if (record.plannedCompletionDate && record.plannedCompletionDate !== existingJob.plannedCompletionDate) {
        existingJob.plannedCompletionDate = record.plannedCompletionDate;
        updates.plannedCompletionDate = record.plannedCompletionDate;
        fieldsChanged = true;
      }

      if (fieldsChanged) {
        anyChange = true;
        if (!isMockMode() && existingJob.id) {
          const db = firebase.firestore();
          db.collection("jobs").doc(existingJob.id).update(updates).then(() => {
            console.log(`[Auto-Sync] Job ${kpNo} fields updated in Firestore.`);
          }).catch(err => {
            console.error(`[Auto-Sync] Failed to update fields in Firestore for ${kpNo}:`, err);
          });
        } else {
          saveState();
        }
      }

      // Sync stage ONLY if the job is still at the initial Inspection stage
      if (existingJob.currentDepartment === "Inspection" && existingJob.currentDepartment !== targetDept) {
        if (window.autoImportedKPs.has(kpNo.toLowerCase())) {
          continue;
        }
        window.autoImportedKPs.add(kpNo.toLowerCase());
        
        console.log(`[Auto-Sync] Job ${kpNo} stage sync: local=${existingJob.currentDepartment}, sheet=${targetDept}. Syncing stage...`);
          
          const oldDept = existingJob.currentDepartment;
          const oldStatus = existingJob.status;
          
          // Optimistically update locally
          existingJob.currentDepartment = targetDept;
          existingJob.status = "Pending";
          if (targetDept === "Masking") {
            existingJob.masking = existingJob.masking || {};
            existingJob.masking.status = "Pending";
            if (!existingJob.masking.materials || existingJob.masking.materials.length === 0) {
              existingJob.masking.materials = [
                { name: "Masking Tape", type: "Tape", batch: "MT-2026-06", unit: "KG", plannedQty: existingJob.quantity, actualQty: 0 },
                { name: "High Temperature Putty", type: "Sealant", batch: "HTP-9921", unit: "Gram", plannedQty: 350, actualQty: 0 }
              ];
            }
          } else if (targetDept === "Final Inspection") {
            existingJob.finalInspection = existingJob.finalInspection || {};
            existingJob.finalInspection.status = "Pending";
          } else if (targetDept === "Spraying") {
            existingJob.spraying = existingJob.spraying || {};
            existingJob.spraying.status = "Pending";
          } else {
            existingJob.masking = existingJob.masking || {};
            existingJob.masking.status = "Pending";
          }
          
          anyChange = true;
          
          try {
            await sendBackendPost({
              type: "UPDATE_JOB_STAGE",
              kpNo: kpNo,
              currentDepartment: targetDept,
              status: "Pending"
            });
            if (isMockMode()) {
              saveState();
            }
            console.log(`[Auto-Sync] Job ${kpNo} successfully updated to ${targetDept} in Firebase.`);
          } catch (err) {
            console.error(`[Auto-Sync] Failed to update stage for job ${kpNo}:`, err);
            // Rollback optimistic update
            existingJob.currentDepartment = oldDept;
            existingJob.status = oldStatus;
            anyChange = true;
          } finally {
            window.autoImportedKPs.delete(kpNo.toLowerCase());
          }
        }
      } else {
      // Job does not exist in local queue. Import it into target stage.
      if (window.autoImportedKPs.has(kpNo.toLowerCase())) {
        continue;
      }
      window.autoImportedKPs.add(kpNo.toLowerCase());
      
      console.log(`[Auto-Sync] Job ${kpNo} not found in system. Auto-importing to ${targetDept} stage...`);
      
      const payload = {
        type: "CREATE_JOB",
        kpNo: kpNo,
        partName: record.partName,
        customer: record.customer,
        quantity: Number(record.quantity) || 1,
        processType: record.processType || "Plasma",
        priority: "Normal",
        currentDepartment: targetDept,
        status: "Pending",
        jcNo: record.jcNo || "",
        inspectionDate: record.inspectionDate || new Date().toISOString().split('T')[0],
        plannedCompletionDate: record.plannedCompletionDate || ""
      };
      
      const newJob = {
        kpNumber: kpNo,
        partName: record.partName,
        customer: record.customer,
        quantity: Number(record.quantity) || 1,
        processType: record.processType || "Plasma",
        priority: "Normal",
        jcNo: record.jcNo || "",
        inspectionDate: record.inspectionDate || new Date().toISOString().split('T')[0],
        plannedCompletionDate: record.plannedCompletionDate || "",
        receivedDate: "",
        currentDepartment: targetDept,
        status: "Pending",
        operatorName: "",
        shift: "",
        masking: { status: "Pending", materials: [], holdHistory: [] },
        spraying: { status: "Pending" },
        grinding: { status: "Pending" },
        polishing: { status: "Pending" },
        finalInspection: { status: "Pending" },
        dispatch: { status: "Pending" }
      };
      
      jobs.push(newJob);
      anyChange = true;
      
      try {
        await sendBackendPost(payload);
        if (isMockMode()) {
          saveState();
        }
        console.log(`[Auto-Sync] Job ${kpNo} successfully created and synchronized to stage ${targetDept}.`);
      } catch (err) {
        console.error(`[Auto-Sync] Failed to save auto-imported job ${kpNo}:`, err);
        jobs = jobs.filter(j => j.kpNumber !== kpNo);
        anyChange = true;
      } finally {
        window.autoImportedKPs.delete(kpNo.toLowerCase());
      }
    }
  }
  
  if (anyChange) {
    renderAll();
  }
}

function loadFirebaseSDKs(callback) {
  if (isMockMode()) {
    callback();
    return;
  }
  
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    try {
      firebase.firestore.setLogLevel('silent');
    } catch (e) {}
    callback();
    return;
  }
  
  const sApp = document.createElement("script");
  sApp.src = "https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js";
  sApp.onload = () => {
    const sAuth = document.createElement("script");
    sAuth.src = "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js";
    sAuth.onload = () => {
      const sStore = document.createElement("script");
      sStore.src = "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js";
      sStore.onload = () => {
        if (!firebase.apps.length) {
          firebase.initializeApp(firebaseConfig);
        }
        try {
          firebase.firestore.setLogLevel('silent');
        } catch (e) {}
        callback();
      };
      document.head.appendChild(sStore);
    };
    document.head.appendChild(sAuth);
  };
  sApp.onerror = () => {
    console.warn("Firebase CDN failed to load in app. Falling back to local Mock Mode.");
    localStorage.setItem("psp_auth_mock", "true");
    callback();
  };
  document.head.appendChild(sApp);
}

// Local database management for Mock Users
const MOCK_DB = {
  getUsers() {
    return JSON.parse(localStorage.getItem('mock_db_users') || '[]');
  },
  saveUsers(users) {
    localStorage.setItem('mock_db_users', JSON.stringify(users));
  },
  getPasswords() {
    return JSON.parse(localStorage.getItem('mock_db_passwords') || '{}');
  },
  addUser(user, password) {
    const users = this.getUsers();
    users.push(user);
    this.saveUsers(users);
    
    const passwords = this.getPasswords();
    passwords[user.email] = password;
    localStorage.setItem('mock_db_passwords', JSON.stringify(passwords));
  }
};

// Role to Menu Mappings
// Role to Menu Mappings
const ROLE_PERMISSIONS = {
  super_admin: [
    'tab-overview', 'tab-inspection', 'tab-masking', 'tab-spraying', 
    'tab-grinding', 'tab-polishing', 'tab-final-inspection', 'tab-dispatch', 
    'tab-audit-logs', 'tab-user-management', 'tab-data-management', 'tab-reports'
  ],
  production_admin: [
    'tab-overview', 'tab-inspection', 'tab-masking', 'tab-spraying', 
    'tab-grinding', 'tab-polishing', 'tab-final-inspection', 'tab-dispatch', 'tab-data-management', 'tab-reports'
  ],
  it_team: [
    'tab-overview', 'tab-data-management', 'tab-reports'
  ],
  hr_admin: [
    'tab-overview', 'tab-inspection', 'tab-masking', 'tab-spraying', 
    'tab-grinding', 'tab-polishing', 'tab-final-inspection', 'tab-dispatch', 'tab-reports'
  ],
  quality_admin: [
    'tab-overview', 'tab-inspection', 'tab-final-inspection', 'tab-reports'
  ],
  operator: {
    Masking: ['tab-masking', 'tab-reports'],
    Spraying: ['tab-spraying', 'tab-reports'],
    Grinding: ['tab-grinding', 'tab-reports'],
    Polishing: ['tab-polishing', 'tab-reports'],
    Inspection: ['tab-inspection', 'tab-reports']
  }
};

function getCleanDeptKey(dept) {
  if (!dept) return "";
  const d = dept.toLowerCase().trim();
  if (d.includes("mask")) return "Masking";
  if (d.includes("spray")) return "Spraying";
  if (d.includes("grind")) return "Grinding";
  if (d.includes("polish")) return "Polishing";
  if (d.includes("inspect")) return "Inspection";
  return dept;
}

function isTabAuthorized(tabId) {
  if (!currentUser) return false;
  const role = currentUser.role;
  if (role === 'super_admin') return ROLE_PERMISSIONS.super_admin.includes(tabId);
  if (role === 'production_admin') return ROLE_PERMISSIONS.production_admin.includes(tabId);
  if (role === 'it_team') return ROLE_PERMISSIONS.it_team.includes(tabId);
  if (role === 'hr_admin') return ROLE_PERMISSIONS.hr_admin.includes(tabId);
  if (role === 'quality_admin') return ROLE_PERMISSIONS.quality_admin.includes(tabId);
  if (role === 'operator') {
    const dept = getCleanDeptKey(currentUser.department);
    const allowed = ROLE_PERMISSIONS.operator[dept] || [];
    return allowed.includes(tabId);
  }
  return false;
}

function loadCachedData() {
  try {
    const cachedJobs = localStorage.getItem("psp_cached_jobs");
    if (cachedJobs) jobs = JSON.parse(cachedJobs);
    
    const cachedDeleted = localStorage.getItem("psp_deleted_jobs");
    if (cachedDeleted) {
      window.deletedJobs = new Set(JSON.parse(cachedDeleted));
    } else {
      window.deletedJobs = new Set();
    }
    
    const cachedUsers = localStorage.getItem("psp_cached_users");
    if (cachedUsers) users = JSON.parse(cachedUsers);
    
    const cachedOperators = localStorage.getItem("psp_cached_operators");
    if (cachedOperators) operators = JSON.parse(cachedOperators);
    
    const cachedMaterials = localStorage.getItem("psp_cached_materials");
    if (cachedMaterials) materials = JSON.parse(cachedMaterials);
    
    const cachedAudit = localStorage.getItem("psp_cached_audit_logs");
    if (cachedAudit) auditLogs = JSON.parse(cachedAudit);
    
    console.log(`[Cache] Loaded offline/startup cache: jobs=${jobs.length}, operators=${operators.length}`);
  } catch (e) {
    console.warn("Failed to load cached local data:", e);
  }
}

function getDefaultTab() {
  if (!currentUser) return 'tab-masking';
  const role = currentUser.role;
  if (role === 'it_team') return 'tab-data-management';
  if (role === 'operator') {
    const dept = getCleanDeptKey(currentUser.department);
    if (dept === 'Masking') return 'tab-masking';
    if (dept === 'Spraying') return 'tab-spraying';
    if (dept === 'Grinding') return 'tab-grinding';
    if (dept === 'Polishing') return 'tab-polishing';
    if (dept === 'Inspection') return 'tab-inspection';
  }
  if (role === 'quality_admin') return 'tab-inspection';
  return 'tab-overview';
}

async function initApp() {
  // 1. Session check
  const userStr = localStorage.getItem("psp_logged_in_user");
  if (!userStr) {
    window.location.href = "login.html";
    return;
  }
  try {
    currentUser = JSON.parse(userStr);
    if (!currentUser || !currentUser.active) {
      localStorage.removeItem("psp_logged_in_user");
      window.location.href = "login.html";
      return;
    }
  } catch (e) {
    localStorage.removeItem("psp_logged_in_user");
    window.location.href = "login.html";
    return;
  }

  // Load cached database immediately for instant, lag-free rendering on page load/refresh
  loadCachedData();

  // Set up permissions and initial routing IMMEDIATELY to prevent UI flicker
  initTheme();
  startClock();
  setupNav();
  setupMaskingSubtabs();
  setupSprayingSubtabs();
  setupGrindingSubtabs();
  setupHamburger();
  populateHeaderUser();
  applySidebarPermissions();
  
  // Setup Zoho View Selector
  const btnViewList = document.getElementById("btn-view-list");
  const btnViewKanban = document.getElementById("btn-view-kanban");
  if (btnViewList && btnViewKanban) {
    btnViewList.addEventListener("click", () => {
      window.overviewViewMode = 'list';
      btnViewList.classList.add("active");
      btnViewKanban.classList.remove("active");
      const listPanel = document.getElementById("overview-list-view-panel");
      const kanbanPanel = document.getElementById("overview-kanban-board-panel");
      if (listPanel) listPanel.style.display = "block";
      if (kanbanPanel) kanbanPanel.style.display = "none";
      renderAll();
    });
    btnViewKanban.addEventListener("click", () => {
      window.overviewViewMode = 'kanban';
      btnViewKanban.classList.add("active");
      btnViewList.classList.remove("active");
      const listPanel = document.getElementById("overview-list-view-panel");
      const kanbanPanel = document.getElementById("overview-kanban-board-panel");
      if (listPanel) listPanel.style.display = "none";
      if (kanbanPanel) kanbanPanel.style.display = "block";
      renderAll();
    });
  }

  // Setup Zoho Global Search Input
  const globalSearchInput = document.getElementById("global-search-input");
  if (globalSearchInput) {
    globalSearchInput.addEventListener("input", (e) => {
      window.globalSearchQuery = e.target.value.trim().toLowerCase();
      renderAll();
    });
  }
  
  // Set up Hash Router triggers
  window.addEventListener("hashchange", handleRouting);
  // Run initial routing on startup (silently redirecting to authorized default)
  handleRouting(true);
  
  // Set up unload handler to prevent navigating away if spraying job is active
  window.addEventListener("beforeunload", (e) => {
    if (window.sprayingJobActive) {
      e.preventDefault();
      e.returnValue = "A Spraying job is currently active. Are you sure you want to exit?";
      return e.returnValue;
    }
  });

  // Setup fullscreen handler for Spraying Operator
  if (currentUser && currentUser.role === 'operator' && getCleanDeptKey(currentUser.department) === 'Spraying') {
    const enterFullscreen = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
          console.warn("Fullscreen request blocked or failed:", err);
        });
      }
    };
    // Enter fullscreen on first user interaction
    document.addEventListener("click", enterFullscreen, { once: true });
    document.addEventListener("touchstart", enterFullscreen, { once: true });

    // Re-request fullscreen on interaction if they exit it while a job is running
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && window.sprayingJobActive) {
        alert("Fullscreen is required while a Spraying job is in progress!");
        document.addEventListener("click", enterFullscreen, { once: true });
        document.addEventListener("touchstart", enterFullscreen, { once: true });
      }
    });
  }
  
  // Load Firebase SDKs first, then start Firestore listeners (if not mock mode) and load initial state
  loadFirebaseSDKs(async () => {
    if (!isMockMode()) {
      firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
          console.log("Firebase user session authenticated:", user.email);
          startFirestoreListeners();
          // Auto seed db if empty (requires super_admin check inside function)
          setTimeout(seedFirestoreDatabaseIfEmpty, 2000);
        } else {
          console.warn("Firebase Auth state: no active user session. Redirecting to login...");
          window.location.href = "login.html";
        }
      });
    } else {
      // Offline / Mock fallback
      await loadState();
    }
    
    // Fetch Google Sheet master data on startup asynchronously (non-blocking)
    setTimeout(() => {
      loadInspectionKPs(false, false).catch(e => console.error("[Inspection] Initial load error:", e));
    }, 300);
    renderAll();
    
    startStateTimer();
    setupEventListeners();
    setupDmdEventListeners(); // Setup DMD dynamic subtab events
    initTransitionDragHandlers();
    startAutoRefresh();

    // Live update: Poll Google Sheet for new KP numbers periodically (configured to 10 minutes)
    // Guard prevents overlapping requests via _inspectionFetchInProgress lock and skips if user is editing
    setInterval(async () => {
      try {
        await loadInspectionKPs(false, true);
        console.log("[Inspection] Auto-refresh check complete.");
      } catch (err) {
        console.warn("[Inspection] Auto-refresh failed:", err.message);
      }
    }, INSPECTION_REFRESH_INTERVAL_MS);
  });
}


// Global KP to JC Number mapping — restore cached map from localStorage for instant JC display
(function restoreCachedJcMap() {
  if (window.kpToJcMap && Object.keys(window.kpToJcMap).length > 0) return;
  try {
    const cached = localStorage.getItem("psp_kp_to_jc_map");
    if (cached) {
      window.kpToJcMap = JSON.parse(cached);
      console.log("[JC Map] Restored", Object.keys(window.kpToJcMap).length, "KP→JC mappings from cache.");
    } else {
      window.kpToJcMap = {};
    }
  } catch (e) {
    console.warn("[JC Map] Failed to restore cached map:", e);
    window.kpToJcMap = {};
  }
})();

function getJobJcNo(job) {
  if (!job) return "";
  if (job.jcNo) return job.jcNo;
  const kp = job.kpNumber || job.kpNo || "";
  if (!kp) return "";
  const cleanKp = String(kp).trim().toUpperCase();
  return window.kpToJcMap && window.kpToJcMap[cleanKp] ? window.kpToJcMap[cleanKp] : "";
}
window.getJobJcNo = getJobJcNo;

// 5. TIME CONVERSION UTILITIES
function formatDuration(ms) {
  if (ms === null || ms === undefined || isNaN(ms) || ms < 0) return "00:00:00";
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0')
  ].join(':');
}

// 6. GLOBAL RENDERING MANAGER (Debounced to prevent multiple layout thrashing on rapid state updates)
let _renderAllTimeout = null;