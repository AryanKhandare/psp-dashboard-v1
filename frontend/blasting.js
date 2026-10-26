/**
 * PSP MES – Blasting Department (stage 04, between Masking and Spraying).
 *
 * Blasting tab: sidebar button, Queue / Active Job / History, start-pause-resume-end pop-ups
 * (operator + qty + store location), the "04. Blasting" drag target, live Blasting data from Firebase,
 * Blasting in every Next Department list, rework prompt for backward moves, permissions.
 *
 * Load after sealing.js (it renumbers the stages after Masking), before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] blasting: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user, isReadOnly, fmt, kpLabel, qtyLabel, stageKeyOf } = window.PSP;
  const MODULE_VERSION = 1;

  // ===================== CONFIG =====================
  const STAGE = "Blasting";
  const LOCATIONS = ["C-20/4", "B-37"];
  const OPERATORS = ["Rupesh", "Devnath", "Sunil", "Suraj", "Prizam", "Damru", "Jayanta"];
  const HOLD_REASONS = ["Material Shortage", "Operator Unavailable", "Machine Issue", "Tool Change / Tool Issue",
                        "Quality Issue", "Customer Hold", "Other"];
  const STAGE_ORDER = ["Inspection", "Machining", "Masking", "Blasting", "Spraying", "Sealing", "Grinding", "Polishing",
                       "Final Inspection", "Dispatch", "Dispatched", "Completed"];

  let selectedKp = null;
  let activeSubtab = "blasting-subtab-queue";

  // ===================== OWN FIREBASE READ FOR BLASTING DATA =====================
  // The app's job loader (firestore-service.js) may not copy the "blasting" field onto jobs.
  // This keeps a live copy of it straight from Firebase and puts it back on the jobs before every render.
  const fsBlasting = new Map(); // KP number -> blasting data from Firebase
  let fsListenersStarted = false;

  function applyFirebaseBlasting() {
    allJobs().forEach(job => {
      const fs = fsBlasting.get(job.kpNumber);
      if (!fs) return;
      const local = job.blasting;
      const localEmpty = !local || typeof local !== "object" || (!local.location && !local.operatorName);
      const fsAhead = local && local.status === "Pending" && fs.status && fs.status !== "Pending";
      if (localEmpty || fsAhead) {
        job.blasting = JSON.parse(JSON.stringify(fs));
        if (!Array.isArray(job.blasting.holdHistory)) job.blasting.holdHistory = [];
      }
    });
  }

  // Starts only once Firebase has been initialised by the app (initApp) and the user is logged in
  function startFirebaseBlastingListeners() {
    if (fsListenersStarted) return;
    if (typeof firebase === "undefined" || !firebase.firestore || !firebase.apps || !firebase.apps.length) return;
    if (typeof isMockMode === "function" && isMockMode()) return;
    let authUser = null;
    try { authUser = firebase.auth().currentUser; } catch (e) { return; }
    if (!authUser || authUser.isAnonymous) return;
    fsListenersStarted = true;
    console.log("[Blasting] Live Firebase blasting data connected.");
    const db = firebase.firestore();
    const onSnap = snap => {
      snap.docChanges().forEach(ch => {
        const d = ch.doc.data();
        if (!d.kpNumber) return;
        if (ch.type === "removed" && d.currentStage !== "Blasting" && !(d.blasting && d.blasting.status === "Completed")) {
          fsBlasting.delete(d.kpNumber);
        } else if (d.blasting) {
          fsBlasting.set(d.kpNumber, d.blasting);
        }
      });
      applyFirebaseBlasting();
      if (typeof renderAll === "function") renderAll();
    };
    const onErr = err => console.warn("[Blasting] Firebase listener error:", err && err.message ? err.message : err);
    // Jobs currently in Blasting, and jobs that finished Blasting (for History)
    db.collection("jobs").where("currentStage", "==", "Blasting").onSnapshot(onSnap, onErr);
    db.collection("jobs").where("blasting.status", "==", "Completed").onSnapshot(onSnap, onErr);
  }

  function ensureBlasting(job) {
    if (!job.blasting || typeof job.blasting !== "object") job.blasting = {};
    const m = job.blasting;
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
        console.error(`[Blasting] Failed to sync ${label}:`, err);
        alert(`Could not save ${label} for ${payload.kpNo}: ${err && err.message ? err.message : err}`);
      });
  }

  function audit(kp, msg) {
    try { if (typeof createAuditLog === "function") createAuditLog((user() && user().email) || "Operator", kp, msg); } catch (e) {}
  }

  // ===================== UI INJECTION =====================
  function injectStyles() {
    const css = `
      .blasting-tab-btn { background:none; border:none; border-right:1px solid var(--border-color); color:var(--text-muted);
        padding:15px 25px; font-family:var(--font-sans); font-size:14px; font-weight:600; cursor:pointer;
        display:flex; align-items:center; gap:8px; transition:all .15s ease; }
      .blasting-tab-btn:hover { background-color:var(--nav-hover-bg); color:var(--text-main); }
      .blasting-tab-btn.active { background-color:var(--bg-panel-header); color:var(--text-highlight); border-bottom:3px solid var(--text-highlight); }
      .blasting-subtab-panel { display:none; }
      .blasting-subtab-panel.active { display:block; }
      body.industrial-theme.light-theme .blasting-tab-btn { border-right-color:#cbd5e1; }
      body.industrial-theme.light-theme .blasting-tab-btn.active { background-color:#cbd5e1; color:#0284c7; border-bottom-color:#0284c7; }
    `;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function injectSidebarButton() {
    const after = $("nav-btn-masking");
    if (!after || $("nav-btn-blasting")) return;
    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.id = "nav-btn-blasting";
    btn.setAttribute("data-tab", "tab-blasting");
    btn.innerHTML = `<span class="stage-num">04</span><span class="stage-name">Blasting stage</span>
                     <span class="stage-badge badge-pending" id="badge-count-blasting">0</span>`;
    // setupNav() bound its buttons before this one existed, so bind it here
    btn.addEventListener("click", () => { window.location.hash = "#/blasting"; });
    after.insertAdjacentElement("afterend", btn);

    // Renumber the stages after Blasting (Spraying 05 … Dispatch 10)
    ["spraying", "sealing", "grinding", "polishing", "final-inspection", "dispatch"].forEach((id, i) => {
      const num = document.querySelector(`#nav-btn-${id} .stage-num`);
      if (num) num.textContent = String(i + 5).padStart(2, "0");
    });
  }

  function injectDropZone() {
    const masking = $("target-zone-masking");
    if (!masking || $("target-zone-blasting")) return;
    const zone = document.createElement("div");
    zone.className = "drop-target-stage";
    zone.id = "target-zone-blasting";
    zone.setAttribute("data-target-stage", STAGE);
    zone.innerHTML = `<span class="drop-icon">💨</span><span class="drop-label">04. Blasting</span>`;
    masking.insertAdjacentElement("afterend", zone);
    const relabel = { spraying: "05. Spraying", sealing: "06. Sealing", grinding: "07. Grinding", polishing: "08. Polishing", final: "09. QA/QC", dispatch: "10. Dispatch" };
    Object.keys(relabel).forEach(k => {
      const lbl = document.querySelector(`#target-zone-${k} .drop-label`);
      if (lbl) lbl.textContent = relabel[k];
    });
  }

  // Add "Blasting" to every stage's Next Department / Next Process list (right before Spraying)
  function injectNextStageOptions() {
    ["spraying-complete-next-process", "grinding-complete-next-process", "masking-complete-next-process",
     "masking-next-process", "no-masking-next-process"].forEach(id => {
      const sel = $(id);
      if (!sel || sel.querySelector('option[value="Blasting"]')) return;
      const o = document.createElement("option");
      o.value = STAGE;
      o.textContent = STAGE;
      const spr = sel.querySelector('option[value="Spraying"]');
      if (spr) spr.insertAdjacentElement("beforebegin", o);
      else sel.insertBefore(o, sel.firstChild);
    });
  }

  function injectUserDeptOption() {
    const sel = $("user-dept");
    if (sel && !sel.querySelector('option[value="Blasting"]')) {
      const o = document.createElement("option");
      o.value = "Blasting";
      o.textContent = "Blasting Operator";
      const spr = sel.querySelector('option[value="Spraying"]');
      sel.insertBefore(o, spr || null);
    }
  }

  function injectTab() {
    const main = document.querySelector(".mes-main-content");
    if (!main || $("tab-blasting")) return;
    const section = document.createElement("section");
    section.id = "tab-blasting";
    section.className = "tab-pane";
    section.innerHTML = `
      <div class="masking-dashboard-header">
        <div class="section-title-wrapper">
          <h2>BLASTING DEPARTMENT CONTROL PANEL</h2>
          <p class="section-desc">Track blasting cycles before spraying: operators, store location, hold time and remarks.</p>
        </div>
      </div>

      <div class="grinding-kpis-grid">
        <div class="metric-card"><span class="metric-val text-orange" id="blasting-kpis-pending">0</span><span class="metric-lbl">Pending Jobs</span></div>
        <div class="metric-card"><span class="metric-val text-blue" id="blasting-kpis-running">0</span><span class="metric-lbl">Running Jobs</span></div>
        <div class="metric-card"><span class="metric-val text-cyan" id="blasting-kpis-machines">0</span><span class="metric-lbl">Cycles Running</span></div>
        <div class="metric-card"><span class="metric-val text-green" id="blasting-kpis-completed">0</span><span class="metric-lbl">Completed Jobs</span></div>
        <div class="metric-card"><span class="metric-val font-mono" id="blasting-kpis-avgtime" style="font-size:24px !important;">00:00:00</span><span class="metric-lbl">Average Cycle Time</span></div>
      </div>

      <div class="grinding-tabs-nav" id="blasting-tabs-nav">
        <button type="button" class="blasting-tab-btn active" data-subtab="blasting-subtab-queue"><span class="subtab-icon">📋</span><span class="subtab-label">Queue</span></button>
        <button type="button" class="blasting-tab-btn" data-subtab="blasting-subtab-active"><span class="subtab-icon">⚡</span><span class="subtab-label">Active Job</span></button>
        <button type="button" class="blasting-tab-btn" data-subtab="blasting-subtab-history"><span class="subtab-icon">📜</span><span class="subtab-label">History</span></button>
      </div>

      <!-- QUEUE -->
      <div id="blasting-subtab-queue" class="blasting-subtab-panel active">
        <div class="panel">
          <div class="panel-header">
            <h3>MODULE 01: BLASTING LIVE DEPARTMENT QUEUE</h3>
            <span class="panel-subtitle">Jobs waiting for or running in blasting.</span>
          </div>
          <div class="panel-body">
            <div class="filters-toolbar">
              <div class="filter-group"><label for="blasting-filter-kp">KP No:</label><input type="text" id="blasting-filter-kp" class="form-input input-sm" placeholder="Search KP..."></div>
              <div class="filter-group"><label for="blasting-filter-jc">JC No:</label><input type="text" id="blasting-filter-jc" class="form-input input-sm" placeholder="Search JC..."></div>
              <div class="filter-group"><label for="blasting-filter-customer">Customer:</label><input type="text" id="blasting-filter-customer" class="form-input input-sm" placeholder="Search Customer..."></div>
              <div class="filter-group"><label for="blasting-filter-machine">Location:</label>
                <select id="blasting-filter-machine" class="form-input select-sm"><option value="">All Locations</option>${opts(LOCATIONS)}</select></div>
              <button id="btn-blasting-clear-filters" class="btn btn-secondary btn-sm" style="height:60px; min-width:120px;">CLEAR FILTERS</button>
            </div>
            <div id="blasting-queue-cards" class="queue-cards-grid"></div>
          </div>
        </div>
      </div>

      <!-- ACTIVE JOB -->
      <div id="blasting-subtab-active" class="blasting-subtab-panel">
        <div class="split-layout">
          <div class="panel active-operation-panel grinding-active-monitor">
            <div class="panel-header header-alert">
              <h3>MODULE 02: ACTIVE BLASTING STATION MONITOR</h3>
              <div class="live-dot-pulse"><span class="pulse-dot"></span><span class="pulse-txt">BLASTING CYCLE</span></div>
            </div>
            <div class="panel-body">
              <div id="blasting-no-active-job-message" class="no-selection-message">
                <p>NO ACTIVE BLASTING CYCLE SELECTED</p>
                <span class="sub-text">Select a job from the Queue sub-tab and tap "Start Blasting", or pick a running cycle on the right.</span>
              </div>
              <div id="blasting-active-job-timer-interface" class="timer-interface-grid" style="display:none;">
                <div class="job-meta-details">
                  <div class="meta-row"><span class="meta-label">KP NUMBER:</span><span id="blasting-active-kp-no" class="font-bold text-cyan" style="font-size:18px;">-</span></div>
                  <div class="meta-row"><span class="meta-label">COMPONENT PART:</span><span id="blasting-active-part-name" class="font-bold">-</span></div>
                  <div class="meta-row"><span class="meta-label">CUSTOMER:</span><span id="blasting-active-customer" class="font-bold">-</span></div>
                  <div class="meta-row"><span class="meta-label">BATCH QUANTITY:</span><span id="blasting-active-qty" class="font-bold font-mono text-cyan" style="font-size:18px;">0</span></div>
                  <div class="meta-row"><span class="meta-label">STORE LOCATION:</span><span id="blasting-active-machine" class="badge badge-normal font-bold" style="font-size:14px; padding:4px 8px;">-</span></div>
                  <div class="meta-row"><span class="meta-label">OPERATOR:</span><span id="blasting-active-operator" class="font-bold" style="font-size:18px; color:#facc15;">-</span></div>
                  <div class="meta-row"><span class="meta-label">CYCLE STATE:</span><span id="blasting-active-status-badge" class="badge badge-progress" style="font-size:14px; padding:4px 8px;">STANDBY</span></div>
                </div>
                <div class="timer-display-box text-center">
                  <span class="meta-label">ELAPSED ACTIVE CYCLE RUNTIME</span>
                  <div class="digital-digits text-cyan" id="blasting-timer-readout">00:00:00</div>
                  <div class="timer-secondary-metrics mt-1 text-muted" style="display:flex; justify-content:center; gap:30px;">
                    <div><span class="timer-sub-lbl">Start: </span><span class="font-mono text-xs" id="blasting-time-started">--:--:--</span></div>
                    <div><span class="timer-sub-lbl">Paused Time: </span><span class="font-mono text-xs text-red" id="blasting-time-paused-total">00:00:00</span></div>
                  </div>
                </div>
                <div class="form-group mt-1">
                  <label for="blasting-remarks">Blasting Remarks / Measurements (optional)</label>
                  <input type="text" id="blasting-remarks" class="form-input" placeholder="Sizes, tool used, finish, observations...">
                </div>
                <div class="timer-actions-bar mt-1" style="display:flex; gap:15px; width:100%;">
                  <button type="button" class="btn btn-success btn-block glove-btn-lg" id="btn-blasting-start-cycle" style="display:none;">START CYCLE</button>
                  <button type="button" class="btn btn-danger btn-block glove-btn-lg" id="btn-blasting-pause-cycle" style="display:none;">PAUSE CYCLE</button>
                  <button type="button" class="btn btn-warning btn-block glove-btn-lg" id="btn-blasting-resume-cycle" style="display:none;">RESUME CYCLE</button>
                  <button type="button" class="btn btn-primary btn-block glove-btn-lg" id="btn-blasting-end-cycle" style="display:none;">END BLASTING</button>
                </div>
              </div>
            </div>
          </div>
          <div class="panel">
            <div class="panel-header"><h3>ACTIVE BLASTING CYCLES</h3></div>
            <div class="panel-body" style="max-height:500px; overflow-y:auto;">
              <div id="blasting-active-job-cards-container" class="active-cards-list"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- HISTORY -->
      <div id="blasting-subtab-history" class="blasting-subtab-panel">
        <div class="panel">
          <div class="panel-header"><h3>MODULE 03: BLASTING JOB CHRONOLOGY LOG</h3></div>
          <div class="panel-body">
            <div class="filters-toolbar">
              <div class="filter-group"><label for="blasting-hist-filter-kp">KP No:</label><input type="text" id="blasting-hist-filter-kp" class="form-input input-sm" placeholder="Search KP..."></div>
              <div class="filter-group"><label for="blasting-hist-filter-customer">Customer:</label><input type="text" id="blasting-hist-filter-customer" class="form-input input-sm" placeholder="Search Customer..."></div>
              <div class="filter-group"><label for="blasting-hist-filter-machine">Location:</label>
                <select id="blasting-hist-filter-machine" class="form-input select-sm"><option value="">All</option>${opts(LOCATIONS)}</select></div>
              <div class="filter-group"><label for="blasting-hist-filter-operator">Operator:</label>
                <select id="blasting-hist-filter-operator" class="form-input select-sm"><option value="">All</option>${opts(OPERATORS)}</select></div>
              <button id="btn-blasting-clear-hist-filters" class="btn btn-secondary btn-sm" style="height:60px; min-width:120px;">CLEAR FILTERS</button>
            </div>
            <div style="overflow-x:auto;">
              <table class="data-table mt-1">
                <thead><tr><th>KP Number</th><th>Part Name</th><th>Customer</th><th>Qty</th><th>Location</th>
                  <th>Operator</th><th>Duration</th><th>Holds</th><th>Now In</th></tr></thead>
                <tbody id="blasting-history-table-body"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
    main.appendChild(section);
  }

  function injectModals() {
    if ($("modal-start-blasting")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="modal-start-blasting" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header"><h3>Start Blasting Operation</h3><button type="button" class="modal-close" data-close="modal-start-blasting">&times;</button></div>
          <div class="modal-body">
            <p>Set up the blasting cycle for <strong id="modal-blasting-kp-display" class="text-cyan"></strong>.</p>
            <form id="blasting-start-form" class="industrial-form mt-1">
              <div class="form-group">
                <label for="blasting-machine-select" style="font-weight:bold; margin-bottom:5px; display:block;">Store Location *</label>
                <select id="blasting-machine-select" class="form-input" style="height:50px; font-size:16px; width:100%;" required>${opts(LOCATIONS, LOCATIONS[0])}</select>
              </div>
              <div class="form-grid">
                <div class="form-group">
                  <label for="blasting-operator-select" style="font-weight:bold; margin-bottom:5px; display:block;">Operator Name *</label>
                  <select id="blasting-operator-select" class="form-input" style="height:50px; font-size:16px; width:100%;" required>
                    <option value="">-- Select Operator --</option>${opts(OPERATORS)}<option value="__other__">Others...</option></select>
                </div>
                <div class="form-group">
                  <label for="blasting-qty-input" style="font-weight:bold; margin-bottom:5px; display:block;">Job Qty (Nos) *</label>
                  <input type="number" id="blasting-qty-input" min="1" class="form-input" style="height:50px; font-size:16px;" required>
                </div>
              </div>
              <div class="form-actions mt-1" style="flex-direction:column; gap:15px;">
                <button type="submit" class="btn btn-success btn-tablet-primary" style="height:60px; font-size:18px;">Start Blasting Cycle</button>
                <button type="button" class="btn btn-secondary modal-cancel-btn" data-close="modal-start-blasting" style="height:60px; font-size:16px; width:100%;">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div id="modal-pause-blasting" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header"><h3>Pause Blasting Operation</h3><button type="button" class="modal-close" data-close="modal-pause-blasting">&times;</button></div>
          <div class="modal-body">
            <p>Select a reason to pause blasting for <strong id="modal-pause-blasting-kp-display" class="text-cyan"></strong>.</p>
            <form id="blasting-pause-form" class="industrial-form mt-1">
              <div class="form-group">
                <label for="blasting-pause-reason-select" style="font-weight:bold; margin-bottom:5px; display:block;">Select Hold Reason *</label>
                <select id="blasting-pause-reason-select" class="form-input" style="height:60px; font-size:18px; width:100%;" required>
                  <option value="">-- Select Reason --</option>${opts(HOLD_REASONS)}</select>
              </div>
              <div class="form-group mt-1">
                <label for="blasting-pause-remarks" style="font-weight:bold; margin-bottom:5px; display:block;">Hold Remarks</label>
                <input type="text" id="blasting-pause-remarks" placeholder="Enter details..." class="form-input" style="height:60px; font-size:18px; width:100%;">
              </div>
              <div class="form-actions mt-1" style="flex-direction:column; gap:15px;">
                <button type="submit" class="btn btn-danger btn-tablet-primary" style="height:60px; font-size:18px;">Pause Cycle</button>
                <button type="button" class="btn btn-secondary modal-cancel-btn" data-close="modal-pause-blasting" style="height:60px; font-size:16px; width:100%;">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div id="modal-complete-blasting" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header"><h3>End Blasting Operation</h3><button type="button" class="modal-close" data-close="modal-complete-blasting">&times;</button></div>
          <div class="modal-body">
            <p>Complete blasting for <strong id="modal-complete-blasting-kp-display" class="text-cyan"></strong>. Next, drag the job card to its next stage.</p>
            <form id="blasting-complete-form" class="industrial-form mt-1">
              <div class="form-group">
                <label for="blasting-complete-qty" style="font-weight:bold; margin-bottom:5px; display:block;">Quantity Done in Blasting *</label>
                <input type="number" id="blasting-complete-qty" class="form-input" min="1" style="height:60px; font-size:18px; width:100%;" required>
                <span class="text-xs text-muted">If less than the full quantity, the done parts move on and the rest stay in Blasting.</span>
              </div>
              <div class="form-actions mt-1" style="flex-direction:column; gap:15px;">
                <button type="submit" class="btn btn-success btn-tablet-primary" style="height:60px; font-size:18px;">Complete &amp; Choose Next Stage</button>
                <button type="button" class="btn btn-secondary modal-cancel-btn" data-close="modal-complete-blasting" style="height:60px; font-size:16px; width:100%;">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
  }

  // ===================== RENDERING =====================
  function blastingJobs() {
    return allJobs().filter(j => j.currentDepartment === STAGE);
  }

  function renderKpis() {
    const inStage = blastingJobs();
    inStage.forEach(ensureBlasting);
    const pending = inStage.filter(j => j.blasting.status === "Pending").length;
    const running = inStage.filter(j => j.blasting.status === "In Progress" || j.blasting.status === "Hold");
    const machinesBusy = new Set(running.filter(j => j.blasting.status === "In Progress").map(j => j.kpNumber));
    const completed = allJobs().filter(j => j.blasting && j.blasting.status === "Completed");
    const durations = completed.map(j => Number(j.blasting.durationMs || j.blasting.activeTimeMs || 0)).filter(Boolean);
    const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("blasting-kpis-pending", pending);
    set("blasting-kpis-running", running.length);
    set("blasting-kpis-machines", machinesBusy.size);
    set("blasting-kpis-completed", completed.length);
    set("blasting-kpis-avgtime", fmt(avg));
  }

  function renderQueue() {
    const box = $("blasting-queue-cards");
    if (!box) return;
    const fKp = ($("blasting-filter-kp").value || "").toLowerCase();
    const fJc = ($("blasting-filter-jc").value || "").toLowerCase();
    const fCust = ($("blasting-filter-customer").value || "").toLowerCase();
    const fMach = $("blasting-filter-machine").value;

    const list = blastingJobs().filter(j => {
      const m = ensureBlasting(j);
      if (m.status === "Completed") return false;
      const jc = (typeof getJobJcNo === "function") ? getJobJcNo(j) : (j.jcNo || "");
      if (fKp && !String(j.kpNumber).toLowerCase().includes(fKp)) return false;
      if (fJc && !String(jc).toLowerCase().includes(fJc)) return false;
      if (fCust && !String(j.customer || "").toLowerCase().includes(fCust)) return false;
      if (fMach && m.location !== fMach) return false;
      return true;
    });

    if (!list.length) {
      box.innerHTML = `<div class="no-selection-message" style="grid-column:1 / -1; width:100%;">No jobs in the Blasting queue.</div>`;
      return;
    }

    box.innerHTML = "";
    const ro = isReadOnly();
    list.forEach(job => {
      const m = job.blasting;
      const card = document.createElement("div");
      card.className = "stage-kanban-card";
      if (typeof getTATUrgency === "function") {
        const u = getTATUrgency(job);
        if (u === "warning") card.classList.add("job-card-tat-warning");
        else if (u === "critical") card.classList.add("job-card-tat-critical");
      }
      const statusClass = m.status === "In Progress" ? "badge-progress" : (m.status === "Hold" ? "badge-hold" : "badge-pending");
      const action = ro ? "" : (m.status === "Pending"
        ? `<button class="btn btn-success btn-xs" style="width:100%; height:32px;" data-mach-start="${esc(job.kpNumber)}">START BLASTING</button>`
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
    const iface = $("blasting-active-job-timer-interface");
    const empty = $("blasting-no-active-job-message");
    const job = selectedKp ? allJobs().find(j => j.kpNumber === selectedKp) : null;
    if (!job || job.currentDepartment !== STAGE || ensureBlasting(job).status === "Completed") {
      selectedKp = null;
      if (iface) iface.style.display = "none";
      if (empty) empty.style.display = "flex";
      return;
    }
    const m = job.blasting;
    if (empty) empty.style.display = "none";
    if (iface) iface.style.display = "flex";

    $("blasting-active-kp-no").textContent = kpLabel(job);
    $("blasting-active-part-name").textContent = job.partName || "-";
    $("blasting-active-customer").textContent = job.customer || "-";
    $("blasting-active-qty").innerHTML = qtyLabel(job);
    $("blasting-active-machine").textContent = m.location || "-";
    $("blasting-active-operator").textContent = m.operatorName || "-";
    const remarks = $("blasting-remarks");
    if (remarks && document.activeElement !== remarks) remarks.value = m.remarks || "";

    const badge = $("blasting-active-status-badge");
    badge.className = "badge";
    if (m.status === "In Progress") { badge.classList.add("badge-progress"); badge.textContent = "RUNNING"; }
    else if (m.status === "Hold") { badge.classList.add("badge-hold"); badge.textContent = "ON HOLD"; }
    else { badge.classList.add("badge-normal"); badge.textContent = "STANDBY"; }

    const ro = isReadOnly();
    const show = (id, on) => { const b = $(id); if (b) b.style.display = (on && !ro) ? "flex" : "none"; };
    show("btn-blasting-start-cycle", m.status === "Pending");
    show("btn-blasting-pause-cycle", m.status === "In Progress");
    show("btn-blasting-resume-cycle", m.status === "Hold");
    show("btn-blasting-end-cycle", m.status === "In Progress" || m.status === "Hold");

    updateTimerReadout(job);
  }

  function updateTimerReadout(job) {
    const m = ensureBlasting(job);
    const readout = $("blasting-timer-readout");
    if (readout) readout.textContent = fmt(runningMs(m));
    const started = $("blasting-time-started");
    if (started) started.textContent = m.startTime
      ? new Date(m.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--";
    const paused = $("blasting-time-paused-total");
    if (paused) {
      const pausedMs = m.startTime ? Math.max(0, (Date.now() - new Date(m.startTime).getTime()) - runningMs(m)) : 0;
      paused.textContent = fmt(pausedMs);
    }
  }

  function renderActiveCards() {
    const box = $("blasting-active-job-cards-container");
    if (!box) return;
    const list = blastingJobs().filter(j => { const s = ensureBlasting(j).status; return s === "In Progress" || s === "Hold"; });
    if (!list.length) {
      box.innerHTML = `<div class="no-selection-message">No running blasting cycles on the shop floor.</div>`;
      return;
    }
    box.innerHTML = "";
    list.forEach(job => {
      const m = job.blasting;
      const card = document.createElement("div");
      card.className = "active-card" + (job.kpNumber === selectedKp ? " selected-card" : "");
      card.addEventListener("click", () => { selectedKp = job.kpNumber; renderBlastingDashboard(); });
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
    const tbody = $("blasting-history-table-body");
    if (!tbody) return;
    const fKp = ($("blasting-hist-filter-kp").value || "").toLowerCase();
    const fCust = ($("blasting-hist-filter-customer").value || "").toLowerCase();
    const fMach = $("blasting-hist-filter-machine").value;
    const fOp = $("blasting-hist-filter-operator").value;
    const list = allJobs().filter(j => {
      const m = j.blasting;
      if (!m || m.status !== "Completed") return false;
      if (fKp && !String(j.kpNumber).toLowerCase().includes(fKp)) return false;
      if (fCust && !String(j.customer || "").toLowerCase().includes(fCust)) return false;
      if (fMach && m.location !== fMach) return false;
      if (fOp && m.operatorName !== fOp) return false;
      return true;
    }).sort((a, b) => String(b.blasting.endTime || "").localeCompare(String(a.blasting.endTime || "")));

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">No completed blasting records.</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(j => {
      const m = j.blasting;
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

  function renderBlastingDashboard() {
    renderKpis();
    if (activeSubtab === "blasting-subtab-queue") renderQueue();
    else if (activeSubtab === "blasting-subtab-active") { renderActiveStation(); renderActiveCards(); }
    else if (activeSubtab === "blasting-subtab-history") renderHistory();
  }
  window.renderBlastingDashboard = renderBlastingDashboard;

  function switchSubtab(id) {
    activeSubtab = id;
    document.querySelectorAll("#tab-blasting .blasting-tab-btn").forEach(b => b.classList.toggle("active", b.getAttribute("data-subtab") === id));
    document.querySelectorAll("#tab-blasting .blasting-subtab-panel").forEach(p => p.classList.toggle("active", p.id === id));
    renderBlastingDashboard();
  }

  function updateBadge() {
    const b = $("badge-count-blasting");
    if (b) b.textContent = blastingJobs().length;
  }

  // ===================== ACTIONS =====================
  function openModal(id) { const m = $(id); if (m) m.classList.add("active"); }
  function closeModal(id) { const m = $(id); if (m) m.classList.remove("active"); }

  function openStartModal(kp) {
    const job = allJobs().find(j => j.kpNumber === kp);
    if (!job) return;
    selectedKp = kp;
    $("modal-blasting-kp-display").textContent = kp;
    $("blasting-machine-select").value = (job.blasting && job.blasting.location) || LOCATIONS[0];
    $("blasting-operator-select").value = "";
    $("blasting-qty-input").value = job.quantity;
    openModal("modal-start-blasting");
  }

  function submitStart(e) {
    e.preventDefault();
    const kp = $("modal-blasting-kp-display").textContent;
    const location = $("blasting-machine-select").value;
    const opSel = $("blasting-operator-select");
    let operator = opSel.value;
    if (operator === "__other__") {
      operator = (prompt("Enter the operator name:") || "").trim();
      if (!operator) return;
    }
    const qty = parseInt($("blasting-qty-input").value, 10);
    if (!location || !operator) { alert("Please select the store location and the operator."); return; }

    const job = allJobs().find(j => j.kpNumber === kp);
    if (!job) return;
    const m = ensureBlasting(job);
    const now = new Date().toISOString();
    Object.assign(m, { status: "In Progress", location, operatorName: operator,
                       quantity: qty || job.quantity, startTime: now, lastStartedAt: now, activeTimeMs: 0, holdHistory: [] });
    job.status = "In Progress";
    selectedKp = kp;
    closeModal("modal-start-blasting");
    switchSubtab("blasting-subtab-active");
    renderAll();
    audit(kp, `Started Blasting at ${location}, operator ${operator}`);
    syncToServer({ type: "START_CYCLE", kpNo: kp, stage: STAGE, operatorName: operator, startTime: now,
                   location, quantity: qty || job.quantity }, "blasting start");
  }

  function openPauseModal() {
    if (!selectedKp) return;
    $("modal-pause-blasting-kp-display").textContent = selectedKp;
    $("blasting-pause-reason-select").value = "";
    $("blasting-pause-remarks").value = "";
    openModal("modal-pause-blasting");
  }

  function submitPause(e) {
    e.preventDefault();
    const reason = $("blasting-pause-reason-select").value;
    const remarks = $("blasting-pause-remarks").value;
    if (!reason) { alert("Please select a hold reason."); return; }
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    const m = ensureBlasting(job);
    if (m.status !== "In Progress") { closeModal("modal-pause-blasting"); return; }
    const now = new Date().toISOString();
    m.activeTimeMs = runningMs(m);
    m.status = "Hold";
    m.lastPausedAt = now;
    m.lastStartedAt = null;
    m.holdHistory.push({ holdTime: now, resumeTime: null, reason, remarks });
    job.status = "Hold";
    closeModal("modal-pause-blasting");
    renderAll();
    audit(job.kpNumber, `Paused Blasting. Reason: ${reason}. ${remarks}`);
    syncToServer({ type: "PAUSE_CYCLE", kpNo: job.kpNumber, stage: STAGE, operatorName: m.operatorName,
                   activeTimeMs: m.activeTimeMs, holdHistory: m.holdHistory, holdReason: reason, remarks }, "blasting pause");
  }

  function resumeCycle() {
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    const m = ensureBlasting(job);
    if (m.status !== "Hold") return;
    const now = new Date().toISOString();
    m.status = "In Progress";
    m.lastStartedAt = now;
    const last = m.holdHistory[m.holdHistory.length - 1];
    if (last && !last.resumeTime) last.resumeTime = now;
    job.status = "In Progress";
    renderAll();
    audit(job.kpNumber, "Resumed Blasting");
    syncToServer({ type: "RESUME_CYCLE", kpNo: job.kpNumber, stage: STAGE, operatorName: m.operatorName,
                   holdHistory: m.holdHistory }, "blasting resume");
  }

  function openCompleteModal() {
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    $("modal-complete-blasting-kp-display").textContent = kpLabel(job);
    const q = $("blasting-complete-qty");
    q.value = job.quantity;
    q.max = job.quantity;
    openModal("modal-complete-blasting");
  }

  function submitComplete(e) {
    e.preventDefault();
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    const m = ensureBlasting(job);
    const doneQty = parseInt($("blasting-complete-qty").value, 10);
    if (isNaN(doneQty) || doneQty <= 0 || doneQty > job.quantity) {
      alert(`Please enter a valid quantity done (1 to ${job.quantity}).`);
      return;
    }
    const remarksEl = $("blasting-remarks");
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
    closeModal("modal-complete-blasting");
    audit(job.kpNumber, `Completed Blasting (${doneQty}/${job.quantity} pcs) at ${m.location || "-"}`);
    showFloatingCardTransition(job, STAGE, payloadGenerator, applyLocalMutation);
  }


  // ===================== HOOKS INTO THE EXISTING APP =====================
  function installHooks() {
    // Permissions: who can open the Blasting tab
    if (typeof ROLE_PERMISSIONS !== "undefined") {
      ["super_admin", "production_admin", "hr_admin"].forEach(r => {
        const list = ROLE_PERMISSIONS[r];
        if (Array.isArray(list) && !list.includes("tab-blasting")) {
          const at = list.indexOf("tab-masking");
          list.splice(at === -1 ? list.length : at + 1, 0, "tab-blasting");
        }
      });
      if (ROLE_PERMISSIONS.operator && !ROLE_PERMISSIONS.operator.Blasting) {
        ROLE_PERMISSIONS.operator.Blasting = ["tab-blasting", "tab-reports"];
      }
    }

    // Blasting operators land on the Blasting tab after login
    if (typeof window.getDefaultTab === "function") {
      const orig = window.getDefaultTab;
      window.getDefaultTab = function () {
        const u = user();
        if (u && u.role === "operator" && String(u.department || "").toLowerCase().includes("seal")) return "tab-blasting";
        return orig.apply(this, arguments);
      };
    }

    // Render the tab and the sidebar badge with every app refresh
    if (typeof window.executeRenderAll === "function") {
      const orig = window.executeRenderAll;
      window.executeRenderAll = function () {
        try { startFirebaseBlastingListeners(); applyFirebaseBlasting(); } catch (e) {}
        const r = orig.apply(this, arguments);
        try {
          updateBadge();
          const pane = $("tab-blasting");
          if (pane && pane.classList.contains("active")) renderBlastingDashboard();
        } catch (e) { console.warn("[Blasting] render error:", e); }
        return r;
      };
    }

    // Jobs pushed into Blasting get a fresh blasting record
    if (typeof window.transitionToStage === "function") {
      const orig = window.transitionToStage;
      window.transitionToStage = function (job, stageName) {
        const r = orig.apply(this, arguments);
        if (stageName === STAGE && job) {
          job.blasting = { status: "Pending", location: "", operatorName: "", quantity: job.quantity,
                            startTime: null, endTime: null, lastStartedAt: null, lastPausedAt: null,
                            activeTimeMs: 0, durationMs: 0, holdHistory: [], remarks: "" };
        }
        return r;
      };
    }

    // Stage order including Blasting: moving a job backwards asks for a rework reason
    if (typeof window.isBackwardTransition === "function") {
      window.isBackwardTransition = function (currentStage, targetStage) {
        const a = STAGE_ORDER.indexOf(currentStage), b = STAGE_ORDER.indexOf(targetStage);
        if (a === -1 || b === -1) return false;
        return b < a;
      };
    }
  }

  // Lets other add-ons (stage board) clear the Blasting station selection when a job is moved away
  window.PSPBlasting = {
    clearSelection(kp) { if (!kp || selectedKp === kp) selectedKp = null; },
    render() { renderBlastingDashboard(); }
  };

  function bindEvents() {
    document.querySelectorAll("#tab-blasting .blasting-tab-btn").forEach(b =>
      b.addEventListener("click", () => switchSubtab(b.getAttribute("data-subtab"))));

    ["blasting-filter-kp", "blasting-filter-jc", "blasting-filter-customer"].forEach(id => $(id).addEventListener("input", renderQueue));
    ["blasting-filter-machine"].forEach(id => $(id).addEventListener("change", renderQueue));
    $("btn-blasting-clear-filters").addEventListener("click", () => {
      ["blasting-filter-kp", "blasting-filter-jc", "blasting-filter-customer", "blasting-filter-machine"].forEach(id => { $(id).value = ""; });
      renderQueue();
    });
    ["blasting-hist-filter-kp", "blasting-hist-filter-customer"].forEach(id => $(id).addEventListener("input", renderHistory));
    ["blasting-hist-filter-machine", "blasting-hist-filter-operator"].forEach(id => $(id).addEventListener("change", renderHistory));
    $("btn-blasting-clear-hist-filters").addEventListener("click", () => {
      ["blasting-hist-filter-kp", "blasting-hist-filter-customer", "blasting-hist-filter-machine", "blasting-hist-filter-operator"].forEach(id => { $(id).value = ""; });
      renderHistory();
    });

    $("blasting-queue-cards").addEventListener("click", e => {
      const start = e.target.closest("[data-mach-start]");
      const view = e.target.closest("[data-mach-view]");
      if (start) openStartModal(start.getAttribute("data-mach-start"));
      if (view) { selectedKp = view.getAttribute("data-mach-view"); switchSubtab("blasting-subtab-active"); }
    });

    $("btn-blasting-start-cycle").addEventListener("click", () => { if (selectedKp) openStartModal(selectedKp); });
    $("btn-blasting-pause-cycle").addEventListener("click", openPauseModal);
    $("btn-blasting-resume-cycle").addEventListener("click", resumeCycle);
    $("btn-blasting-end-cycle").addEventListener("click", openCompleteModal);

    $("blasting-start-form").addEventListener("submit", submitStart);
    $("blasting-pause-form").addEventListener("submit", submitPause);
    $("blasting-complete-form").addEventListener("submit", submitComplete);
    document.querySelectorAll("[data-close]").forEach(b => {
      if (b.getAttribute("data-close").indexOf("blasting") !== -1) b.addEventListener("click", () => closeModal(b.getAttribute("data-close")));
    });

    // Live timers once a second while the Blasting tab is open
    setInterval(() => {
      const pane = $("tab-blasting");
      if (!pane || !pane.classList.contains("active")) return;
      if (selectedKp) {
        const job = allJobs().find(j => j.kpNumber === selectedKp);
        if (job && job.blasting) updateTimerReadout(job);
      }
      document.querySelectorAll("[data-mach-timer]").forEach(el => {
        const job = allJobs().find(j => j.kpNumber === el.getAttribute("data-mach-timer"));
        if (job && job.blasting) el.textContent = fmt(runningMs(job.blasting));
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
      try { startFirebaseBlastingListeners(); } catch (e) {}
      if (fsListenersStarted) clearInterval(fsWait);
    }, 1500);
    console.log("[PSP] blasting v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] blasting failed to load:", err);
  }
})();
