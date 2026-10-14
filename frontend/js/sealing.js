/**
 * PSP MES – Sealing Department (stage 05, between Spraying and Grinding).
 *
 * Sealing tab: sidebar button, Queue / Active Job / History, start-pause-resume-end pop-ups
 * (operator + qty + store location), the "05. Sealing" drag target, live Sealing data from Firebase,
 * Sealing in every Next Department list, rework prompt for backward moves, permissions.
 *
 * Load after machining.js (it renumbers the stages after Spraying), before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] sealing: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user, isReadOnly, fmt, kpLabel, qtyLabel, stageKeyOf } = window.PSP;
  const MODULE_VERSION = 1;

  // ===================== CONFIG =====================
  const STAGE = "Sealing";
  const LOCATIONS = ["C-20/4", "B-37"];
  const OPERATORS = ["Rajkaran", "Suraj", "Prisam"];
  const HOLD_REASONS = ["Material Shortage", "Operator Unavailable", "Machine Issue", "Tool Change / Tool Issue",
                        "Quality Issue", "Customer Hold", "Other"];
  const STAGE_ORDER = ["Inspection", "Machining", "Masking", "Spraying", "Sealing", "Grinding", "Polishing",
                       "Final Inspection", "Dispatch", "Dispatched", "Completed"];

  let selectedKp = null;
  let activeSubtab = "sealing-subtab-queue";

  // ===================== OWN FIREBASE READ FOR SEALING DATA =====================
  // The app's job loader (firestore-service.js) may not copy the "sealing" field onto jobs.
  // This keeps a live copy of it straight from Firebase and puts it back on the jobs before every render.
  const fsSealing = new Map(); // KP number -> sealing data from Firebase
  let fsListenersStarted = false;

  function applyFirebaseSealing() {
    allJobs().forEach(job => {
      const fs = fsSealing.get(job.kpNumber);
      if (!fs) return;
      const local = job.sealing;
      const localEmpty = !local || typeof local !== "object" || (!local.location && !local.operatorName);
      const fsAhead = local && local.status === "Pending" && fs.status && fs.status !== "Pending";
      if (localEmpty || fsAhead) {
        job.sealing = JSON.parse(JSON.stringify(fs));
        if (!Array.isArray(job.sealing.holdHistory)) job.sealing.holdHistory = [];
      }
    });
  }

  // Starts only once Firebase has been initialised by the app (initApp) and the user is logged in
  function startFirebaseSealingListeners() {
    if (fsListenersStarted) return;
    if (typeof firebase === "undefined" || !firebase.firestore || !firebase.apps || !firebase.apps.length) return;
    if (typeof isMockMode === "function" && isMockMode()) return;
    let authUser = null;
    try { authUser = firebase.auth().currentUser; } catch (e) { return; }
    if (!authUser || authUser.isAnonymous) return;
    fsListenersStarted = true;
    console.log("[Sealing] Live Firebase sealing data connected.");
    const db = firebase.firestore();
    const onSnap = snap => {
      snap.docChanges().forEach(ch => {
        const d = ch.doc.data();
        if (!d.kpNumber) return;
        if (ch.type === "removed" && d.currentStage !== "Sealing" && !(d.sealing && d.sealing.status === "Completed")) {
          fsSealing.delete(d.kpNumber);
        } else if (d.sealing) {
          fsSealing.set(d.kpNumber, d.sealing);
        }
      });
      applyFirebaseSealing();
      if (typeof renderAll === "function") renderAll();
    };
    const onErr = err => console.warn("[Sealing] Firebase listener error:", err && err.message ? err.message : err);
    // Jobs currently in Sealing, and jobs that finished Sealing (for History)
    db.collection("jobs").where("currentStage", "==", "Sealing").onSnapshot(onSnap, onErr);
    db.collection("jobs").where("sealing.status", "==", "Completed").onSnapshot(onSnap, onErr);
  }

  function ensureSealing(job) {
    if (!job.sealing || typeof job.sealing !== "object") job.sealing = {};
    const m = job.sealing;
    if (!m.status) m.status = "Pending";
    if (!Array.isArray(m.holdHistory)) m.holdHistory = [];
    return m;
  }

  function runningMs(m) {
    let ms = Number(m.activeTimeMs || 0);
    if (m.status === "In Progress" && m.lastStartedAt) ms += Date.now() - new Date(m.lastStartedAt).getTime();
    return ms;
  }

  function syncToServer(payload, label) {
    if (typeof pendingSyncCount !== "undefined") pendingSyncCount++;
    return sendBackendPost(payload)
      .then(() => {
        if (typeof pendingSyncCount !== "undefined") pendingSyncCount--;
        if (typeof pendingSyncCount !== "undefined" && pendingSyncCount === 0 && typeof loadState === "function") {
          return loadState().then(() => renderAll());
        }
      })
      .catch(err => {
        if (typeof pendingSyncCount !== "undefined") pendingSyncCount--;
        console.error(`[Sealing] Failed to sync ${label}:`, err);
        alert(`Could not save ${label} for ${payload.kpNo}: ${err && err.message ? err.message : err}`);
      });
  }

  function audit(kp, msg) {
    try { if (typeof createAuditLog === "function") createAuditLog((user() && user().email) || "Operator", kp, msg); } catch (e) {}
  }

  // ===================== UI INJECTION =====================
  function injectStyles() {
    const css = `
      .sealing-tab-btn { background:none; border:none; border-right:1px solid var(--border-color); color:var(--text-muted);
        padding:15px 25px; font-family:var(--font-sans); font-size:14px; font-weight:600; cursor:pointer;
        display:flex; align-items:center; gap:8px; transition:all .15s ease; }
      .sealing-tab-btn:hover { background-color:var(--nav-hover-bg); color:var(--text-main); }
      .sealing-tab-btn.active { background-color:var(--bg-panel-header); color:var(--text-highlight); border-bottom:3px solid var(--text-highlight); }
      .sealing-subtab-panel { display:none; }
      .sealing-subtab-panel.active { display:block; }
      body.industrial-theme.light-theme .sealing-tab-btn { border-right-color:#cbd5e1; }
      body.industrial-theme.light-theme .sealing-tab-btn.active { background-color:#cbd5e1; color:#0284c7; border-bottom-color:#0284c7; }
    `;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function injectSidebarButton() {
    const after = $("nav-btn-spraying");
    if (!after || $("nav-btn-sealing")) return;
    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.id = "nav-btn-sealing";
    btn.setAttribute("data-tab", "tab-sealing");
    btn.innerHTML = `<span class="stage-num">05</span><span class="stage-name">Sealing stage</span>
                     <span class="stage-badge badge-pending" id="badge-count-sealing">0</span>`;
    // setupNav() bound its buttons before this one existed, so bind it here
    btn.addEventListener("click", () => { window.location.hash = "#/sealing"; });
    after.insertAdjacentElement("afterend", btn);

    // Renumber the stages after Sealing (Grinding 06 … Dispatch 09)
    ["grinding", "polishing", "final-inspection", "dispatch"].forEach((id, i) => {
      const num = document.querySelector(`#nav-btn-${id} .stage-num`);
      if (num) num.textContent = String(i + 6).padStart(2, "0");
    });
  }

  function injectDropZone() {
    const spraying = $("target-zone-spraying");
    if (!spraying || $("target-zone-sealing")) return;
    const zone = document.createElement("div");
    zone.className = "drop-target-stage";
    zone.id = "target-zone-sealing";
    zone.setAttribute("data-target-stage", STAGE);
    zone.innerHTML = `<span class="drop-icon">🧴</span><span class="drop-label">05. Sealing</span>`;
    spraying.insertAdjacentElement("afterend", zone);
    const relabel = { grinding: "06. Grinding", polishing: "07. Polishing", final: "08. QA/QC", dispatch: "09. Dispatch" };
    Object.keys(relabel).forEach(k => {
      const lbl = document.querySelector(`#target-zone-${k} .drop-label`);
      if (lbl) lbl.textContent = relabel[k];
    });
  }

  // Add "Sealing" to every stage's Next Department / Next Process list (right after Spraying)
  function injectNextStageOptions() {
    ["spraying-complete-next-process", "grinding-complete-next-process", "masking-complete-next-process",
     "masking-next-process", "no-masking-next-process"].forEach(id => {
      const sel = $(id);
      if (!sel || sel.querySelector('option[value="Sealing"]')) return;
      const o = document.createElement("option");
      o.value = STAGE;
      o.textContent = STAGE;
      const spr = sel.querySelector('option[value="Spraying"]');
      if (spr) spr.insertAdjacentElement("afterend", o);
      else sel.insertBefore(o, sel.firstChild);
    });
  }

  function injectUserDeptOption() {
    const sel = $("user-dept");
    if (sel && !sel.querySelector('option[value="Sealing"]')) {
      const o = document.createElement("option");
      o.value = "Sealing";
      o.textContent = "Sealing Operator";
      const spr = sel.querySelector('option[value="Spraying"]');
      sel.insertBefore(o, spr ? spr.nextSibling : null);
    }
  }

  function injectTab() {
    const main = document.querySelector(".mes-main-content");
    if (!main || $("tab-sealing")) return;
    const section = document.createElement("section");
    section.id = "tab-sealing";
    section.className = "tab-pane";
    section.innerHTML = `
      <div class="masking-dashboard-header">
        <div class="section-title-wrapper">
          <h2>SEALING DEPARTMENT CONTROL PANEL</h2>
          <p class="section-desc">Track sealing cycles after spraying: operators, store location, hold time and remarks.</p>
        </div>
      </div>

      <div class="grinding-kpis-grid">
        <div class="metric-card"><span class="metric-val text-orange" id="sealing-kpis-pending">0</span><span class="metric-lbl">Pending Jobs</span></div>
        <div class="metric-card"><span class="metric-val text-blue" id="sealing-kpis-running">0</span><span class="metric-lbl">Running Jobs</span></div>
        <div class="metric-card"><span class="metric-val text-cyan" id="sealing-kpis-machines">0</span><span class="metric-lbl">Cycles Running</span></div>
        <div class="metric-card"><span class="metric-val text-green" id="sealing-kpis-completed">0</span><span class="metric-lbl">Completed Jobs</span></div>
        <div class="metric-card"><span class="metric-val font-mono" id="sealing-kpis-avgtime" style="font-size:24px !important;">00:00:00</span><span class="metric-lbl">Average Cycle Time</span></div>
      </div>

      <div class="grinding-tabs-nav" id="sealing-tabs-nav">
        <button type="button" class="sealing-tab-btn active" data-subtab="sealing-subtab-queue"><span class="subtab-icon">📋</span><span class="subtab-label">Queue</span></button>
        <button type="button" class="sealing-tab-btn" data-subtab="sealing-subtab-active"><span class="subtab-icon">⚡</span><span class="subtab-label">Active Job</span></button>
        <button type="button" class="sealing-tab-btn" data-subtab="sealing-subtab-history"><span class="subtab-icon">📜</span><span class="subtab-label">History</span></button>
      </div>

      <!-- QUEUE -->
      <div id="sealing-subtab-queue" class="sealing-subtab-panel active">
        <div class="panel">
          <div class="panel-header">
            <h3>MODULE 01: SEALING LIVE DEPARTMENT QUEUE</h3>
            <span class="panel-subtitle">Jobs waiting for or running in sealing.</span>
          </div>
          <div class="panel-body">
            <div class="filters-toolbar">
              <div class="filter-group"><label for="sealing-filter-kp">KP No:</label><input type="text" id="sealing-filter-kp" class="form-input input-sm" placeholder="Search KP..."></div>
              <div class="filter-group"><label for="sealing-filter-jc">JC No:</label><input type="text" id="sealing-filter-jc" class="form-input input-sm" placeholder="Search JC..."></div>
              <div class="filter-group"><label for="sealing-filter-customer">Customer:</label><input type="text" id="sealing-filter-customer" class="form-input input-sm" placeholder="Search Customer..."></div>
              <div class="filter-group"><label for="sealing-filter-machine">Location:</label>
                <select id="sealing-filter-machine" class="form-input select-sm"><option value="">All Locations</option>${opts(LOCATIONS)}</select></div>
              <button id="btn-sealing-clear-filters" class="btn btn-secondary btn-sm" style="height:60px; min-width:120px;">CLEAR FILTERS</button>
            </div>
            <div id="sealing-queue-cards" class="queue-cards-grid"></div>
          </div>
        </div>
      </div>

      <!-- ACTIVE JOB -->
      <div id="sealing-subtab-active" class="sealing-subtab-panel">
        <div class="split-layout">
          <div class="panel active-operation-panel grinding-active-monitor">
            <div class="panel-header header-alert">
              <h3>MODULE 02: ACTIVE SEALING STATION MONITOR</h3>
              <div class="live-dot-pulse"><span class="pulse-dot"></span><span class="pulse-txt">SEALING CYCLE</span></div>
            </div>
            <div class="panel-body">
              <div id="sealing-no-active-job-message" class="no-selection-message">
                <p>NO ACTIVE SEALING CYCLE SELECTED</p>
                <span class="sub-text">Select a job from the Queue sub-tab and tap "Start Sealing", or pick a running cycle on the right.</span>
              </div>
              <div id="sealing-active-job-timer-interface" class="timer-interface-grid" style="display:none;">
                <div class="job-meta-details">
                  <div class="meta-row"><span class="meta-label">KP NUMBER:</span><span id="sealing-active-kp-no" class="font-bold text-cyan" style="font-size:18px;">-</span></div>
                  <div class="meta-row"><span class="meta-label">COMPONENT PART:</span><span id="sealing-active-part-name" class="font-bold">-</span></div>
                  <div class="meta-row"><span class="meta-label">CUSTOMER:</span><span id="sealing-active-customer" class="font-bold">-</span></div>
                  <div class="meta-row"><span class="meta-label">BATCH QUANTITY:</span><span id="sealing-active-qty" class="font-bold font-mono text-cyan" style="font-size:18px;">0</span></div>
                  <div class="meta-row"><span class="meta-label">STORE LOCATION:</span><span id="sealing-active-machine" class="badge badge-normal font-bold" style="font-size:14px; padding:4px 8px;">-</span></div>
                  <div class="meta-row"><span class="meta-label">OPERATOR:</span><span id="sealing-active-operator" class="font-bold" style="font-size:18px; color:#facc15;">-</span></div>
                  <div class="meta-row"><span class="meta-label">CYCLE STATE:</span><span id="sealing-active-status-badge" class="badge badge-progress" style="font-size:14px; padding:4px 8px;">STANDBY</span></div>
                </div>
                <div class="timer-display-box text-center">
                  <span class="meta-label">ELAPSED ACTIVE CYCLE RUNTIME</span>
                  <div class="digital-digits text-cyan" id="sealing-timer-readout">00:00:00</div>
                  <div class="timer-secondary-metrics mt-1 text-muted" style="display:flex; justify-content:center; gap:30px;">
                    <div><span class="timer-sub-lbl">Start: </span><span class="font-mono text-xs" id="sealing-time-started">--:--:--</span></div>
                    <div><span class="timer-sub-lbl">Paused Time: </span><span class="font-mono text-xs text-red" id="sealing-time-paused-total">00:00:00</span></div>
                  </div>
                </div>
                <div class="form-group mt-1">
                  <label for="sealing-remarks">Sealing Remarks / Measurements (optional)</label>
                  <input type="text" id="sealing-remarks" class="form-input" placeholder="Sizes, tool used, finish, observations...">
                </div>
                <div class="timer-actions-bar mt-1" style="display:flex; gap:15px; width:100%;">
                  <button type="button" class="btn btn-success btn-block glove-btn-lg" id="btn-sealing-start-cycle" style="display:none;">START CYCLE</button>
                  <button type="button" class="btn btn-danger btn-block glove-btn-lg" id="btn-sealing-pause-cycle" style="display:none;">PAUSE CYCLE</button>
                  <button type="button" class="btn btn-warning btn-block glove-btn-lg" id="btn-sealing-resume-cycle" style="display:none;">RESUME CYCLE</button>
                  <button type="button" class="btn btn-primary btn-block glove-btn-lg" id="btn-sealing-end-cycle" style="display:none;">END SEALING</button>
                </div>
              </div>
            </div>
          </div>
          <div class="panel">
            <div class="panel-header"><h3>ACTIVE SEALING CYCLES</h3></div>
            <div class="panel-body" style="max-height:500px; overflow-y:auto;">
              <div id="sealing-active-job-cards-container" class="active-cards-list"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- HISTORY -->
      <div id="sealing-subtab-history" class="sealing-subtab-panel">
        <div class="panel">
          <div class="panel-header"><h3>MODULE 03: SEALING JOB CHRONOLOGY LOG</h3></div>
          <div class="panel-body">
            <div class="filters-toolbar">
              <div class="filter-group"><label for="sealing-hist-filter-kp">KP No:</label><input type="text" id="sealing-hist-filter-kp" class="form-input input-sm" placeholder="Search KP..."></div>
              <div class="filter-group"><label for="sealing-hist-filter-customer">Customer:</label><input type="text" id="sealing-hist-filter-customer" class="form-input input-sm" placeholder="Search Customer..."></div>
              <div class="filter-group"><label for="sealing-hist-filter-machine">Location:</label>
                <select id="sealing-hist-filter-machine" class="form-input select-sm"><option value="">All</option>${opts(LOCATIONS)}</select></div>
              <div class="filter-group"><label for="sealing-hist-filter-operator">Operator:</label>
                <select id="sealing-hist-filter-operator" class="form-input select-sm"><option value="">All</option>${opts(OPERATORS)}</select></div>
              <button id="btn-sealing-clear-hist-filters" class="btn btn-secondary btn-sm" style="height:60px; min-width:120px;">CLEAR FILTERS</button>
            </div>
            <div style="overflow-x:auto;">
              <table class="data-table mt-1">
                <thead><tr><th>KP Number</th><th>Part Name</th><th>Customer</th><th>Qty</th><th>Location</th>
                  <th>Operator</th><th>Duration</th><th>Holds</th><th>Now In</th></tr></thead>
                <tbody id="sealing-history-table-body"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
    main.appendChild(section);
  }

  function injectModals() {
    if ($("modal-start-sealing")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="modal-start-sealing" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header"><h3>Start Sealing Operation</h3><button type="button" class="modal-close" data-close="modal-start-sealing">&times;</button></div>
          <div class="modal-body">
            <p>Set up the sealing cycle for <strong id="modal-sealing-kp-display" class="text-cyan"></strong>.</p>
            <form id="sealing-start-form" class="industrial-form mt-1">
              <div class="form-group">
                <label for="sealing-machine-select" style="font-weight:bold; margin-bottom:5px; display:block;">Store Location *</label>
                <select id="sealing-machine-select" class="form-input" style="height:50px; font-size:16px; width:100%;" required>${opts(LOCATIONS, LOCATIONS[0])}</select>
              </div>
              <div class="form-grid">
                <div class="form-group">
                  <label for="sealing-operator-select" style="font-weight:bold; margin-bottom:5px; display:block;">Operator Name *</label>
                  <select id="sealing-operator-select" class="form-input" style="height:50px; font-size:16px; width:100%;" required>
                    <option value="">-- Select Operator --</option>${opts(OPERATORS)}<option value="__other__">Others...</option></select>
                </div>
                <div class="form-group">
                  <label for="sealing-qty-input" style="font-weight:bold; margin-bottom:5px; display:block;">Job Qty (Nos) *</label>
                  <input type="number" id="sealing-qty-input" min="1" class="form-input" style="height:50px; font-size:16px;" required>
                </div>
              </div>
              <div class="form-actions mt-1" style="flex-direction:column; gap:15px;">
                <button type="submit" class="btn btn-success btn-tablet-primary" style="height:60px; font-size:18px;">Start Sealing Cycle</button>
                <button type="button" class="btn btn-secondary modal-cancel-btn" data-close="modal-start-sealing" style="height:60px; font-size:16px; width:100%;">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div id="modal-pause-sealing" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header"><h3>Pause Sealing Operation</h3><button type="button" class="modal-close" data-close="modal-pause-sealing">&times;</button></div>
          <div class="modal-body">
            <p>Select a reason to pause sealing for <strong id="modal-pause-sealing-kp-display" class="text-cyan"></strong>.</p>
            <form id="sealing-pause-form" class="industrial-form mt-1">
              <div class="form-group">
                <label for="sealing-pause-reason-select" style="font-weight:bold; margin-bottom:5px; display:block;">Select Hold Reason *</label>
                <select id="sealing-pause-reason-select" class="form-input" style="height:60px; font-size:18px; width:100%;" required>
                  <option value="">-- Select Reason --</option>${opts(HOLD_REASONS)}</select>
              </div>
              <div class="form-group mt-1">
                <label for="sealing-pause-remarks" style="font-weight:bold; margin-bottom:5px; display:block;">Hold Remarks</label>
                <input type="text" id="sealing-pause-remarks" placeholder="Enter details..." class="form-input" style="height:60px; font-size:18px; width:100%;">
              </div>
              <div class="form-actions mt-1" style="flex-direction:column; gap:15px;">
                <button type="submit" class="btn btn-danger btn-tablet-primary" style="height:60px; font-size:18px;">Pause Cycle</button>
                <button type="button" class="btn btn-secondary modal-cancel-btn" data-close="modal-pause-sealing" style="height:60px; font-size:16px; width:100%;">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div id="modal-complete-sealing" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header"><h3>End Sealing Operation</h3><button type="button" class="modal-close" data-close="modal-complete-sealing">&times;</button></div>
          <div class="modal-body">
            <p>Complete sealing for <strong id="modal-complete-sealing-kp-display" class="text-cyan"></strong>. Next, drag the job card to its next stage.</p>
            <form id="sealing-complete-form" class="industrial-form mt-1">
              <div class="form-group">
                <label for="sealing-complete-qty" style="font-weight:bold; margin-bottom:5px; display:block;">Quantity Done in Sealing *</label>
                <input type="number" id="sealing-complete-qty" class="form-input" min="1" style="height:60px; font-size:18px; width:100%;" required>
                <span class="text-xs text-muted">If less than the full quantity, the done parts move on and the rest stay in Sealing.</span>
              </div>
              <div class="form-actions mt-1" style="flex-direction:column; gap:15px;">
                <button type="submit" class="btn btn-success btn-tablet-primary" style="height:60px; font-size:18px;">Complete &amp; Choose Next Stage</button>
                <button type="button" class="btn btn-secondary modal-cancel-btn" data-close="modal-complete-sealing" style="height:60px; font-size:16px; width:100%;">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
  }

  // ===================== RENDERING =====================
  function sealingJobs() {
    return allJobs().filter(j => j.currentDepartment === STAGE);
  }

  function renderKpis() {
    const inStage = sealingJobs();
    inStage.forEach(ensureSealing);
    const pending = inStage.filter(j => j.sealing.status === "Pending").length;
    const running = inStage.filter(j => j.sealing.status === "In Progress" || j.sealing.status === "Hold");
    const machinesBusy = new Set(running.filter(j => j.sealing.status === "In Progress").map(j => j.kpNumber));
    const completed = allJobs().filter(j => j.sealing && j.sealing.status === "Completed");
    const durations = completed.map(j => Number(j.sealing.durationMs || j.sealing.activeTimeMs || 0)).filter(Boolean);
    const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("sealing-kpis-pending", pending);
    set("sealing-kpis-running", running.length);
    set("sealing-kpis-machines", machinesBusy.size);
    set("sealing-kpis-completed", completed.length);
    set("sealing-kpis-avgtime", fmt(avg));
  }

  function renderQueue() {
    const box = $("sealing-queue-cards");
    if (!box) return;
    const fKp = ($("sealing-filter-kp").value || "").toLowerCase();
    const fJc = ($("sealing-filter-jc").value || "").toLowerCase();
    const fCust = ($("sealing-filter-customer").value || "").toLowerCase();
    const fMach = $("sealing-filter-machine").value;

    const list = sealingJobs().filter(j => {
      const m = ensureSealing(j);
      if (m.status === "Completed") return false;
      const jc = (typeof getJobJcNo === "function") ? getJobJcNo(j) : (j.jcNo || "");
      if (fKp && !String(j.kpNumber).toLowerCase().includes(fKp)) return false;
      if (fJc && !String(jc).toLowerCase().includes(fJc)) return false;
      if (fCust && !String(j.customer || "").toLowerCase().includes(fCust)) return false;
      if (fMach && m.location !== fMach) return false;
      return true;
    });

    if (!list.length) {
      box.innerHTML = `<div class="no-selection-message" style="grid-column:1 / -1; width:100%;">No jobs in the Sealing queue.</div>`;
      return;
    }

    box.innerHTML = "";
    const ro = isReadOnly();
    list.forEach(job => {
      const m = job.sealing;
      const card = document.createElement("div");
      card.className = "stage-kanban-card";
      if (typeof getTATUrgency === "function") {
        const u = getTATUrgency(job);
        if (u === "warning") card.classList.add("job-card-tat-warning");
        else if (u === "critical") card.classList.add("job-card-tat-critical");
      }
      const statusClass = m.status === "In Progress" ? "badge-progress" : (m.status === "Hold" ? "badge-hold" : "badge-pending");
      const action = ro ? "" : (m.status === "Pending"
        ? `<button class="btn btn-success btn-xs" style="width:100%; height:32px;" data-mach-start="${esc(job.kpNumber)}">START SEALING</button>`
        : `<button class="btn btn-primary btn-xs" style="width:100%; height:32px;" data-mach-view="${esc(job.kpNumber)}">VIEW STATION</button>`);
      card.innerHTML = `
        <div class="stage-card-priority-strip ${esc(String(job.priority || "Normal").toLowerCase())}"></div>
        <div class="job-card-header" style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
          <span class="font-mono font-bold text-cyan" style="font-size:14px;">${esc(kpLabel(job))}</span>
          <div style="display:flex; align-items:center; gap:6px;">
            ${typeof buildTATChipHTML === "function" ? buildTATChipHTML(job) : ""}
            <span class="badge ${statusClass}" style="font-size:10px; font-weight:700;">${esc(m.status)}</span>
          </div>
        </div>
        <div class="job-card-body" style="font-size:12px; display:flex; flex-direction:column; gap:4px; margin-bottom:12px;">
          <div class="job-card-row"><span class="job-card-label">Part Name:</span><span class="job-card-value">${esc(job.partName)}</span></div>
          <div class="job-card-row"><span class="job-card-label">Customer:</span><span class="job-card-value">${esc(job.customer)}</span></div>
          <div class="job-card-row"><span class="job-card-label">Quantity:</span><span class="job-card-value font-mono">${qtyLabel(job)}</span></div>
          ${job.splitRemark ? `<div class="job-card-row" style="flex-direction:column; align-items:flex-start;"><span class="job-card-label" style="color:#f97316 !important; font-size:11px; font-weight:bold;">Split Remark:</span><span class="job-card-value" style="color:#f97316 !important; font-size:11px; white-space:normal;">${esc(job.splitRemark)}</span></div>` : ""}
          ${m.operatorName ? `<div class="job-card-row"><span class="job-card-label">Operator:</span><span class="job-card-value font-bold text-cyan">${esc(m.operatorName)}</span></div>` : ""}
          ${m.location ? `<div class="job-card-row"><span class="job-card-label">Location:</span><span class="job-card-value">${esc(m.location)}</span></div>` : ""}
          <div class="job-card-row"><span class="job-card-label">Priority:</span><span class="job-card-value font-bold text-cyan">${esc(job.priority || "Normal")}</span></div>
          ${typeof buildCardArrivalTimerHTML === "function" ? buildCardArrivalTimerHTML(job) : ""}
        </div>
        <div class="stage-card-actions" style="margin-top:10px; border-top:1px solid rgba(255,255,255,0.05); padding-top:10px; display:flex; flex-direction:column; gap:8px;">
          ${action}
          ${typeof buildDeleteJobButtonHTML === "function" ? buildDeleteJobButtonHTML(job.kpNumber) : ""}
        </div>`;
      box.appendChild(card);
    });
  }

  function renderActiveStation() {
    const iface = $("sealing-active-job-timer-interface");
    const empty = $("sealing-no-active-job-message");
    const job = selectedKp ? allJobs().find(j => j.kpNumber === selectedKp) : null;
    if (!job || job.currentDepartment !== STAGE || ensureSealing(job).status === "Completed") {
      selectedKp = null;
      if (iface) iface.style.display = "none";
      if (empty) empty.style.display = "flex";
      return;
    }
    const m = job.sealing;
    if (empty) empty.style.display = "none";
    if (iface) iface.style.display = "flex";

    $("sealing-active-kp-no").textContent = kpLabel(job);
    $("sealing-active-part-name").textContent = job.partName || "-";
    $("sealing-active-customer").textContent = job.customer || "-";
    $("sealing-active-qty").innerHTML = qtyLabel(job);
    $("sealing-active-machine").textContent = m.location || "-";
    $("sealing-active-operator").textContent = m.operatorName || "-";
    const remarks = $("sealing-remarks");
    if (remarks && document.activeElement !== remarks) remarks.value = m.remarks || "";

    const badge = $("sealing-active-status-badge");
    badge.className = "badge";
    if (m.status === "In Progress") { badge.classList.add("badge-progress"); badge.textContent = "RUNNING"; }
    else if (m.status === "Hold") { badge.classList.add("badge-hold"); badge.textContent = "ON HOLD"; }
    else { badge.classList.add("badge-normal"); badge.textContent = "STANDBY"; }

    const ro = isReadOnly();
    const show = (id, on) => { const b = $(id); if (b) b.style.display = (on && !ro) ? "flex" : "none"; };
    show("btn-sealing-start-cycle", m.status === "Pending");
    show("btn-sealing-pause-cycle", m.status === "In Progress");
    show("btn-sealing-resume-cycle", m.status === "Hold");
    show("btn-sealing-end-cycle", m.status === "In Progress" || m.status === "Hold");

    updateTimerReadout(job);
  }

  function updateTimerReadout(job) {
    const m = ensureSealing(job);
    const readout = $("sealing-timer-readout");
    if (readout) readout.textContent = fmt(runningMs(m));
    const started = $("sealing-time-started");
    if (started) started.textContent = m.startTime
      ? new Date(m.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--";
    const paused = $("sealing-time-paused-total");
    if (paused) {
      const pausedMs = m.startTime ? Math.max(0, (Date.now() - new Date(m.startTime).getTime()) - runningMs(m)) : 0;
      paused.textContent = fmt(pausedMs);
    }
  }

  function renderActiveCards() {
    const box = $("sealing-active-job-cards-container");
    if (!box) return;
    const list = sealingJobs().filter(j => { const s = ensureSealing(j).status; return s === "In Progress" || s === "Hold"; });
    if (!list.length) {
      box.innerHTML = `<div class="no-selection-message">No running sealing cycles on the shop floor.</div>`;
      return;
    }
    box.innerHTML = "";
    list.forEach(job => {
      const m = job.sealing;
      const card = document.createElement("div");
      card.className = "active-card" + (job.kpNumber === selectedKp ? " selected-card" : "");
      card.addEventListener("click", () => { selectedKp = job.kpNumber; renderSealingDashboard(); });
      card.innerHTML = `
        <div class="card-left">
          <div class="card-kp-row"><span class="card-kp">${esc(kpLabel(job))}</span>
            <span class="badge ${m.status === "Hold" ? "badge-hold" : "badge-progress"} text-xs">${esc(m.status)}</span></div>
          <span class="card-part">${esc(job.partName)} (${qtyLabel(job)})</span>
          <span class="card-op-info">${esc(m.location || "-")} · ${esc(m.operatorName || "-")}</span>
        </div>
        <div class="card-right"><span class="card-time font-mono" data-mach-timer="${esc(job.kpNumber)}">${fmt(runningMs(m))}</span>
          <span class="text-xs text-muted">Active Run</span></div>`;
      box.appendChild(card);
    });
  }

  function renderHistory() {
    const tbody = $("sealing-history-table-body");
    if (!tbody) return;
    const fKp = ($("sealing-hist-filter-kp").value || "").toLowerCase();
    const fCust = ($("sealing-hist-filter-customer").value || "").toLowerCase();
    const fMach = $("sealing-hist-filter-machine").value;
    const fOp = $("sealing-hist-filter-operator").value;
    const list = allJobs().filter(j => {
      const m = j.sealing;
      if (!m || m.status !== "Completed") return false;
      if (fKp && !String(j.kpNumber).toLowerCase().includes(fKp)) return false;
      if (fCust && !String(j.customer || "").toLowerCase().includes(fCust)) return false;
      if (fMach && m.location !== fMach) return false;
      if (fOp && m.operatorName !== fOp) return false;
      return true;
    }).sort((a, b) => String(b.sealing.endTime || "").localeCompare(String(a.sealing.endTime || "")));

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">No completed sealing records.</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(j => {
      const m = j.sealing;
      const holds = Array.isArray(m.holdHistory) ? m.holdHistory.length : 0;
      return `<tr>
        <td class="font-mono font-bold text-cyan">${esc(j.kpNumber)}</td>
        <td>${esc(j.partName)}</td><td>${esc(j.customer)}</td>
        <td class="font-mono">${esc(m.quantity || j.quantity)}</td>
        <td>${esc(m.location || "-")}</td><td>${esc(m.operatorName || "-")}</td>
        <td class="font-mono">${fmt(m.durationMs || m.activeTimeMs)}</td><td>${holds}</td>
        <td><strong>${esc(j.currentDepartment || "-")}</strong></td></tr>`;
    }).join("");
  }

  function renderSealingDashboard() {
    renderKpis();
    if (activeSubtab === "sealing-subtab-queue") renderQueue();
    else if (activeSubtab === "sealing-subtab-active") { renderActiveStation(); renderActiveCards(); }
    else if (activeSubtab === "sealing-subtab-history") renderHistory();
  }
  window.renderSealingDashboard = renderSealingDashboard;

  function switchSubtab(id) {
    activeSubtab = id;
    document.querySelectorAll("#tab-sealing .sealing-tab-btn").forEach(b => b.classList.toggle("active", b.getAttribute("data-subtab") === id));
    document.querySelectorAll("#tab-sealing .sealing-subtab-panel").forEach(p => p.classList.toggle("active", p.id === id));
    renderSealingDashboard();
  }

  function updateBadge() {
    const b = $("badge-count-sealing");
    if (b) b.textContent = sealingJobs().length;
  }

  // ===================== ACTIONS =====================
  function openModal(id) { const m = $(id); if (m) m.classList.add("active"); }
  function closeModal(id) { const m = $(id); if (m) m.classList.remove("active"); }

  function openStartModal(kp) {
    const job = allJobs().find(j => j.kpNumber === kp);
    if (!job) return;
    selectedKp = kp;
    $("modal-sealing-kp-display").textContent = kp;
    $("sealing-machine-select").value = (job.sealing && job.sealing.location) || LOCATIONS[0];
    $("sealing-operator-select").value = "";
    $("sealing-qty-input").value = job.quantity;
    openModal("modal-start-sealing");
  }

  function submitStart(e) {
    e.preventDefault();
    const kp = $("modal-sealing-kp-display").textContent;
    const location = $("sealing-machine-select").value;
    const opSel = $("sealing-operator-select");
    let operator = opSel.value;
    if (operator === "__other__") {
      operator = (prompt("Enter the operator name:") || "").trim();
      if (!operator) return;
    }
    const qty = parseInt($("sealing-qty-input").value, 10);
    if (!location || !operator) { alert("Please select the store location and the operator."); return; }

    const job = allJobs().find(j => j.kpNumber === kp);
    if (!job) return;
    const m = ensureSealing(job);
    const now = new Date().toISOString();
    Object.assign(m, { status: "In Progress", location, operatorName: operator,
                       quantity: qty || job.quantity, startTime: now, lastStartedAt: now, activeTimeMs: 0, holdHistory: [] });
    job.status = "In Progress";
    selectedKp = kp;
    closeModal("modal-start-sealing");
    switchSubtab("sealing-subtab-active");
    renderAll();
    audit(kp, `Started Sealing at ${location}, operator ${operator}`);
    syncToServer({ type: "START_CYCLE", kpNo: kp, stage: STAGE, operatorName: operator, startTime: now,
                   location, quantity: qty || job.quantity }, "sealing start");
  }

  function openPauseModal() {
    if (!selectedKp) return;
    $("modal-pause-sealing-kp-display").textContent = selectedKp;
    $("sealing-pause-reason-select").value = "";
    $("sealing-pause-remarks").value = "";
    openModal("modal-pause-sealing");
  }

  function submitPause(e) {
    e.preventDefault();
    const reason = $("sealing-pause-reason-select").value;
    const remarks = $("sealing-pause-remarks").value;
    if (!reason) { alert("Please select a hold reason."); return; }
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    const m = ensureSealing(job);
    if (m.status !== "In Progress") { closeModal("modal-pause-sealing"); return; }
    const now = new Date().toISOString();
    m.activeTimeMs = runningMs(m);
    m.status = "Hold";
    m.lastPausedAt = now;
    m.lastStartedAt = null;
    m.holdHistory.push({ holdTime: now, resumeTime: null, reason, remarks });
    job.status = "Hold";
    closeModal("modal-pause-sealing");
    renderAll();
    audit(job.kpNumber, `Paused Sealing. Reason: ${reason}. ${remarks}`);
    syncToServer({ type: "PAUSE_CYCLE", kpNo: job.kpNumber, stage: STAGE, operatorName: m.operatorName,
                   activeTimeMs: m.activeTimeMs, holdHistory: m.holdHistory, holdReason: reason, remarks }, "sealing pause");
  }

  function resumeCycle() {
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    const m = ensureSealing(job);
    if (m.status !== "Hold") return;
    const now = new Date().toISOString();
    m.status = "In Progress";
    m.lastStartedAt = now;
    const last = m.holdHistory[m.holdHistory.length - 1];
    if (last && !last.resumeTime) last.resumeTime = now;
    job.status = "In Progress";
    renderAll();
    audit(job.kpNumber, "Resumed Sealing");
    syncToServer({ type: "RESUME_CYCLE", kpNo: job.kpNumber, stage: STAGE, operatorName: m.operatorName,
                   holdHistory: m.holdHistory }, "sealing resume");
  }

  function openCompleteModal() {
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    $("modal-complete-sealing-kp-display").textContent = kpLabel(job);
    const q = $("sealing-complete-qty");
    q.value = job.quantity;
    q.max = job.quantity;
    openModal("modal-complete-sealing");
  }

  function submitComplete(e) {
    e.preventDefault();
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    const m = ensureSealing(job);
    const doneQty = parseInt($("sealing-complete-qty").value, 10);
    if (isNaN(doneQty) || doneQty <= 0 || doneQty > job.quantity) {
      alert(`Please enter a valid quantity done (1 to ${job.quantity}).`);
      return;
    }
    const remarksEl = $("sealing-remarks");
    m.remarks = remarksEl ? remarksEl.value : (m.remarks || "");
    const now = new Date().toISOString();
    const activeMs = runningMs(m);
    const last = m.holdHistory[m.holdHistory.length - 1];
    if (m.status === "Hold" && last && !last.resumeTime) last.resumeTime = now;
    const isSplit = doneQty < job.quantity;
    const operator = m.operatorName || ((user() && user().email) || "Operator");

    const payloadGenerator = nextStage => {
      if (isSplit) {
        return splitJobAndProgress(job, doneQty, nextStage, operator, STAGE, {
          location: m.location, remarks: m.remarks,
          durationMs: activeMs, activeTimeMs: activeMs, holdHistory: m.holdHistory, quantity: doneQty
        });
      }
      return { type: "END_CYCLE", kpNo: job.kpNumber, stage: STAGE, operatorName: operator, endTime: now,
               activeTimeMs: activeMs, holdHistory: m.holdHistory, nextStage };
    };
    const applyLocalMutation = nextStage => {
      if (!isSplit) {
        Object.assign(m, { status: "Completed", endTime: now, durationMs: activeMs, activeTimeMs: activeMs, nextProcess: nextStage });
        transitionToStage(job, nextStage, operator);
      }
    };

    selectedKp = null;
    closeModal("modal-complete-sealing");
    audit(job.kpNumber, `Completed Sealing (${doneQty}/${job.quantity} pcs) at ${m.location || "-"}`);
    showFloatingCardTransition(job, STAGE, payloadGenerator, applyLocalMutation);
  }


  // ===================== HOOKS INTO THE EXISTING APP =====================
  function installHooks() {
    // Permissions: who can open the Sealing tab
    if (typeof ROLE_PERMISSIONS !== "undefined") {
      ["super_admin", "production_admin", "hr_admin"].forEach(r => {
        const list = ROLE_PERMISSIONS[r];
        if (Array.isArray(list) && !list.includes("tab-sealing")) {
          const at = list.indexOf("tab-spraying");
          list.splice(at === -1 ? list.length : at + 1, 0, "tab-sealing");
        }
      });
      if (ROLE_PERMISSIONS.operator && !ROLE_PERMISSIONS.operator.Sealing) {
        ROLE_PERMISSIONS.operator.Sealing = ["tab-sealing", "tab-reports"];
      }
    }

    // Sealing operators land on the Sealing tab after login
    if (typeof window.getDefaultTab === "function") {
      const orig = window.getDefaultTab;
      window.getDefaultTab = function () {
        const u = user();
        if (u && u.role === "operator" && String(u.department || "").toLowerCase().includes("seal")) return "tab-sealing";
        return orig.apply(this, arguments);
      };
    }

    // Render the tab and the sidebar badge with every app refresh
    if (typeof window.executeRenderAll === "function") {
      const orig = window.executeRenderAll;
      window.executeRenderAll = function () {
        try { startFirebaseSealingListeners(); applyFirebaseSealing(); } catch (e) {}
        const r = orig.apply(this, arguments);
        try {
          updateBadge();
          const pane = $("tab-sealing");
          if (pane && pane.classList.contains("active")) renderSealingDashboard();
        } catch (e) { console.warn("[Sealing] render error:", e); }
        return r;
      };
    }

    // Jobs pushed into Sealing get a fresh sealing record
    if (typeof window.transitionToStage === "function") {
      const orig = window.transitionToStage;
      window.transitionToStage = function (job, stageName) {
        const r = orig.apply(this, arguments);
        if (stageName === STAGE && job) {
          job.sealing = { status: "Pending", location: "", operatorName: "", quantity: job.quantity,
                            startTime: null, endTime: null, lastStartedAt: null, lastPausedAt: null,
                            activeTimeMs: 0, durationMs: 0, holdHistory: [], remarks: "" };
        }
        return r;
      };
    }

    // Stage order including Sealing: moving a job backwards asks for a rework reason
    if (typeof window.isBackwardTransition === "function") {
      window.isBackwardTransition = function (currentStage, targetStage) {
        const a = STAGE_ORDER.indexOf(currentStage), b = STAGE_ORDER.indexOf(targetStage);
        if (a === -1 || b === -1) return false;
        return b < a;
      };
    }
  }

  // Lets other add-ons (stage board) clear the Sealing station selection when a job is moved away
  window.PSPSealing = {
    clearSelection(kp) { if (!kp || selectedKp === kp) selectedKp = null; },
    render() { renderSealingDashboard(); }
  };

  function bindEvents() {
    document.querySelectorAll("#tab-sealing .sealing-tab-btn").forEach(b =>
      b.addEventListener("click", () => switchSubtab(b.getAttribute("data-subtab"))));

    ["sealing-filter-kp", "sealing-filter-jc", "sealing-filter-customer"].forEach(id => $(id).addEventListener("input", renderQueue));
    ["sealing-filter-machine"].forEach(id => $(id).addEventListener("change", renderQueue));
    $("btn-sealing-clear-filters").addEventListener("click", () => {
      ["sealing-filter-kp", "sealing-filter-jc", "sealing-filter-customer", "sealing-filter-machine"].forEach(id => { $(id).value = ""; });
      renderQueue();
    });
    ["sealing-hist-filter-kp", "sealing-hist-filter-customer"].forEach(id => $(id).addEventListener("input", renderHistory));
    ["sealing-hist-filter-machine", "sealing-hist-filter-operator"].forEach(id => $(id).addEventListener("change", renderHistory));
    $("btn-sealing-clear-hist-filters").addEventListener("click", () => {
      ["sealing-hist-filter-kp", "sealing-hist-filter-customer", "sealing-hist-filter-machine", "sealing-hist-filter-operator"].forEach(id => { $(id).value = ""; });
      renderHistory();
    });

    $("sealing-queue-cards").addEventListener("click", e => {
      const start = e.target.closest("[data-mach-start]");
      const view = e.target.closest("[data-mach-view]");
      if (start) openStartModal(start.getAttribute("data-mach-start"));
      if (view) { selectedKp = view.getAttribute("data-mach-view"); switchSubtab("sealing-subtab-active"); }
    });

    $("btn-sealing-start-cycle").addEventListener("click", () => { if (selectedKp) openStartModal(selectedKp); });
    $("btn-sealing-pause-cycle").addEventListener("click", openPauseModal);
    $("btn-sealing-resume-cycle").addEventListener("click", resumeCycle);
    $("btn-sealing-end-cycle").addEventListener("click", openCompleteModal);

    $("sealing-start-form").addEventListener("submit", submitStart);
    $("sealing-pause-form").addEventListener("submit", submitPause);
    $("sealing-complete-form").addEventListener("submit", submitComplete);
    document.querySelectorAll("[data-close]").forEach(b => {
      if (b.getAttribute("data-close").indexOf("sealing") !== -1) b.addEventListener("click", () => closeModal(b.getAttribute("data-close")));
    });

    // Live timers once a second while the Sealing tab is open
    setInterval(() => {
      const pane = $("tab-sealing");
      if (!pane || !pane.classList.contains("active")) return;
      if (selectedKp) {
        const job = allJobs().find(j => j.kpNumber === selectedKp);
        if (job && job.sealing) updateTimerReadout(job);
      }
      document.querySelectorAll("[data-mach-timer]").forEach(el => {
        const job = allJobs().find(j => j.kpNumber === el.getAttribute("data-mach-timer"));
        if (job && job.sealing) el.textContent = fmt(runningMs(job.sealing));
      });
    }, 1000);
  }

  // ===================== BOOT =====================
  try {
    injectStyles();
    injectSidebarButton();
    injectTab();
    injectModals();
    injectDropZone();
    injectUserDeptOption();
    injectNextStageOptions();
    installHooks();
    bindEvents();
    // Firebase is initialised later by the app, so keep checking until it is ready
    const fsWait = setInterval(() => {
      try { startFirebaseSealingListeners(); } catch (e) {}
      if (fsListenersStarted) clearInterval(fsWait);
    }, 1500);
    console.log("[PSP] sealing v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] sealing failed to load:", err);
  }
})();
