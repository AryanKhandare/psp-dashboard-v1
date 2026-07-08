
async function parseRowsMainThreadAsync(rows, op, chunkSize = 200) {
  const cleanDate = (col) => {
    if (!col) return "";
    let val = col.v;
    if (val && (val instanceof Date || Object.prototype.toString.call(val) === '[object Date]')) {
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const d = String(val.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    let strVal = col.f || col.v;
    if (strVal === undefined || strVal === null) return "";
    strVal = String(strVal).trim();
    if (strVal.startsWith("Date(")) {
      try {
        const parts = strVal.replace("Date(", "").replace(")", "").split(",").map(Number);
        if (parts.length >= 3) {
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

  return new Promise((resolve) => {
    let index = 0;
    const results = [];
    function nextChunk() {
      const end = Math.min(index + chunkSize, rows.length);
      for (; index < end; index++) {
        const row = rows[index];
        const cols = row.c || [];
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

        if (kpVal && /^kp-/i.test(kpVal)) {
          let keep = true;
          if (op) {
            const upperOp = op.trim().toUpperCase();
            const a1 = assignedFirst.toUpperCase();
            const a2 = assignedSecond.toUpperCase();
            keep = (a1 === upperOp || a2 === upperOp);
          }
          if (keep) {
            results.push({ 
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
            });
          }
        }
      }
      if (index < rows.length) {
        setTimeout(nextChunk, 0);
      } else {
        resolve(results);
      }
    }
    nextChunk();
  });
}

// Check if user is currently interacting with or has inputs in the form
function isUserEditingInspectionForm() {
  const form = document.getElementById("inspection-job-form");
  if (form && form.contains(document.activeElement)) {
    return true;
  }
  const kpVal = document.getElementById("inspect-kp-no")?.value;
  const partVal = document.getElementById("inspect-part-name")?.value;
  const custVal = document.getElementById("inspect-customer")?.value;
  const qtyVal = document.getElementById("inspect-quantity")?.value;
  return !!(kpVal || partVal || custVal || qtyVal);
}

function shouldBypassMasking(partName) {
  if (!partName) return false;
  const p = partName.trim().toLowerCase();
  const bypassParts = [
    "test coupon",
    "button",
    "flat",
    "cylinder",
    "copper samples",
    "wire drawing drum ( block )"
  ];
  return bypassParts.some(bp => p === bp || p.includes(bp));
}

function isMockMode() {
  return typeof firebaseConfig === 'undefined' || !firebaseConfig.apiKey || firebaseConfig.apiKey.includes("YOUR_FIREBASE_") || localStorage.getItem("psp_auth_mock") === "true";
}

async function syncMaskingJobToBackend(job, nextDept) {
  if (!job.rowIndex) {
    console.warn("No rowIndex found for job", job.kpNumber, "- cannot update Google Sheets.");
    return;
  }
  
  try {
    const payload = {
      type: "SAVE_MASKING_JOB",
      rowIndex: job.rowIndex,
      kpNo: job.kpNumber,
      qty: job.quantity,
      doerQty: job.quantity,
      startTime: job.masking.startTime,
      endTime: job.masking.endTime,
      nextProcess: nextDept || "Spraying",
      operatorName: job.masking.operatorName || "System"
    };

    console.log("Sending SAVE_MASKING_JOB to backend:", payload);
    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain"
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) throw new Error("HTTP error " + response.status);
    const result = await response.json();
    console.log("Saved masking job response from backend:", result);
    
    renderSprayingDashboard();
  } catch (err) {
    console.error("Failed to sync completed masking job to backend:", err);
  }
}

// DOM Elements
const clockElement = document.getElementById("header-clock");
const shiftSelect = document.getElementById("header-shift-select");

// Sidebar Badges
const badgeInspection = document.getElementById("badge-count-inspection");
const badgeMasking = document.getElementById("badge-count-masking");
const badgeSpraying = document.getElementById("badge-count-spraying");

// TAB panes & navigation
const navButtons = document.querySelectorAll(".nav-btn");
const tabPanes = document.querySelectorAll(".tab-pane");

// Initialize application
window.addEventListener("DOMContentLoaded", () => {
  initApp();
});