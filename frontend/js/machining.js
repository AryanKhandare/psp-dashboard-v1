/**
 * PSP MES – Machining Department (stage 02, between Inspection and Masking).
 *
 * Self-contained module: builds its own sidebar button, tab (Queue / Active Job / History),
 * pop-ups and drag-to-next-stage target, and plugs into the existing permissions, rendering,
 * timers and Firebase save logic (START_CYCLE / PAUSE_CYCLE / RESUME_CYCLE / END_CYCLE / SPLIT_STAGE).
 *
 * Load in index.html AFTER grinding.js and dashboard.js, BEFORE app.js.
 * Requires firestore-service.js to map the "machining" field (one line, see setup notes).
 */
(function () {
  // ===================== CONFIG =====================
  const STAGE = "Machining";
  const MACHINES = ["Lathe Machine-1", "Lathe Machine-2", "Lathe Machine-3", "Lathe Machine-4",
                    "Lathe Machine-5", "Lathe Machine-6", "Lathe Machine-7"];
  const OPERATORS = ["Viraj", "Bhim", "Sandesh", "Manoj"];
  const PROCESSES = ["Pre Machining", "Post Machining"];
  const HOLD_REASONS = ["Material Shortage", "Operator Unavailable", "Machine Issue", "Tool Change / Tool Issue",
                        "Quality Issue", "Customer Hold", "Other"];
  const STAGE_ORDER = ["Inspection", "Machining", "Masking", "Spraying", "Grinding", "Polishing",
                       "Final Inspection", "Dispatch", "Dispatched", "Completed"];

  const MODULE_VERSION = 9;
  let selectedKp = null;
  let boardDragging = false; // pause board redraws while a card is being dragged
  let activeSubtab = "machining-subtab-queue";

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const opts = (list, selected) => list.map(v => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join("");
  const allJobs = () => (typeof jobs !== "undefined" && Array.isArray(jobs)) ? jobs : [];
  const user = () => (typeof currentUser !== "undefined" && currentUser) ? currentUser : null;
  const isReadOnly = () => { const u = user(); return !!(u && u.role === "hr_admin"); };
  const fmt = ms => (typeof formatDuration === "function") ? formatDuration(ms || 0) : "00:00:00";
  const kpLabel = job => {
    const kp = (typeof getCleanKpNumber === "function") ? getCleanKpNumber(job.kpNumber) : job.kpNumber;
    const jc = (typeof getJobJcNo === "function") ? getJobJcNo(job) : (job.jcNo || "");
    return jc ? `${kp} (${jc})` : kp;
  };
  const qtyLabel = job => (typeof renderQuantityWithHistory === "function") ? renderQuantityWithHistory(job) : esc(job.quantity);

  function ensureMachining(job) {
    if (!job.machining || typeof job.machining !== "object") job.machining = {};
    const m = job.machining;
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
        console.error(`[Machining] Failed to sync ${label}:`, err);
        alert(`Could not save ${label} for ${payload.kpNo}: ${err && err.message ? err.message : err}`);
      });
  }

  function audit(kp, msg) {
    try { if (typeof createAuditLog === "function") createAuditLog((user() && user().email) || "Operator", kp, msg); } catch (e) {}
  }

  // ===================== UI INJECTION =====================
  function injectStyles() {
    const css = `
      .machining-tab-btn { background:none; border:none; border-right:1px solid var(--border-color); color:var(--text-muted);
        padding:15px 25px; font-family:var(--font-sans); font-size:14px; font-weight:600; cursor:pointer;
        display:flex; align-items:center; gap:8px; transition:all .15s ease; }
      .machining-tab-btn:hover { background-color:var(--nav-hover-bg); color:var(--text-main); }
      .machining-tab-btn.active { background-color:var(--bg-panel-header); color:var(--text-highlight); border-bottom:3px solid var(--text-highlight); }
      .machining-subtab-panel { display:none; }
      .machining-subtab-panel.active { display:block; }
      body.industrial-theme.light-theme .machining-tab-btn { border-right-color:#cbd5e1; }
      body.industrial-theme.light-theme .machining-tab-btn.active { background-color:#cbd5e1; color:#0284c7; border-bottom-color:#0284c7; }
    `;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function injectSidebarButton() {
    const after = $("nav-btn-inspection");
    if (!after || $("nav-btn-machining")) return;
    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.id = "nav-btn-machining";
    btn.setAttribute("data-tab", "tab-machining");
    btn.innerHTML = `<span class="stage-num">02</span><span class="stage-name">Machining stage</span>
                     <span class="stage-badge badge-pending" id="badge-count-machining">0</span>`;
    // setupNav() bound its buttons before this one existed, so bind it here
    btn.addEventListener("click", () => { window.location.hash = "#/machining"; });
    after.insertAdjacentElement("afterend", btn);

    // Renumber the stages that come after Machining (02 → 03, ... 07 → 08)
    ["masking", "spraying", "grinding", "polishing", "final-inspection", "dispatch"].forEach((id, i) => {
      const num = document.querySelector(`#nav-btn-${id} .stage-num`);
      if (num) num.textContent = String(i + 3).padStart(2, "0");
    });
  }

  function injectDropZone() {
    const masking = $("target-zone-masking");
    if (!masking || $("target-zone-machining")) return;
    const zone = document.createElement("div");
    zone.className = "drop-target-stage";
    zone.id = "target-zone-machining";
    zone.setAttribute("data-target-stage", STAGE);
    zone.innerHTML = `<span class="drop-icon">🛠️</span><span class="drop-label">02. Machining</span>`;
    masking.insertAdjacentElement("beforebegin", zone);
    const relabel = { masking: "03. Masking", spraying: "04. Spraying", grinding: "05. Grinding",
                      polishing: "06. Polishing", final: "07. QA/QC", dispatch: "08. Dispatch" };
    Object.keys(relabel).forEach(k => {
      const lbl = document.querySelector(`#target-zone-${k} .drop-label`);
      if (lbl) lbl.textContent = relabel[k];
    });
  }

  function injectUserDeptOption() {
    const sel = $("user-dept");
    if (sel && !sel.querySelector('option[value="Machining"]')) {
      const o = document.createElement("option");
      o.value = "Machining";
      o.textContent = "Machining Operator";
      const insp = sel.querySelector('option[value="Inspection"]');
      sel.insertBefore(o, insp ? insp.nextSibling : null);
    }
  }

  function injectTab() {
    const main = document.querySelector(".mes-main-content");
    if (!main || $("tab-machining")) return;
    const section = document.createElement("section");
    section.id = "tab-machining";
    section.className = "tab-pane";
    section.innerHTML = `
      <div class="masking-dashboard-header">
        <div class="section-title-wrapper">
          <h2>MACHINING DEPARTMENT CONTROL PANEL</h2>
          <p class="section-desc">Track lathe machining cycles (pre / post machining), machine usage, operators and hold time.</p>
        </div>
      </div>

      <div class="grinding-kpis-grid">
        <div class="metric-card"><span class="metric-val text-orange" id="machining-kpis-pending">0</span><span class="metric-lbl">Pending Jobs</span></div>
        <div class="metric-card"><span class="metric-val text-blue" id="machining-kpis-running">0</span><span class="metric-lbl">Running Jobs</span></div>
        <div class="metric-card"><span class="metric-val text-cyan" id="machining-kpis-machines">0</span><span class="metric-lbl">Machines Running</span></div>
        <div class="metric-card"><span class="metric-val text-green" id="machining-kpis-completed">0</span><span class="metric-lbl">Completed Jobs</span></div>
        <div class="metric-card"><span class="metric-val font-mono" id="machining-kpis-avgtime" style="font-size:24px !important;">00:00:00</span><span class="metric-lbl">Average Cycle Time</span></div>
      </div>

      <div class="grinding-tabs-nav" id="machining-tabs-nav">
        <button type="button" class="machining-tab-btn active" data-subtab="machining-subtab-queue"><span class="subtab-icon">📋</span><span class="subtab-label">Queue</span></button>
        <button type="button" class="machining-tab-btn" data-subtab="machining-subtab-active"><span class="subtab-icon">⚡</span><span class="subtab-label">Active Job</span></button>
        <button type="button" class="machining-tab-btn" data-subtab="machining-subtab-history"><span class="subtab-icon">📜</span><span class="subtab-label">History</span></button>
      </div>

      <!-- QUEUE -->
      <div id="machining-subtab-queue" class="machining-subtab-panel active">
        <div class="panel">
          <div class="panel-header">
            <h3>MODULE 01: MACHINING LIVE DEPARTMENT QUEUE</h3>
            <span class="panel-subtitle">Jobs waiting for or running on the lathe machines.</span>
          </div>
          <div class="panel-body">
            <div class="filters-toolbar">
              <div class="filter-group"><label for="machining-filter-kp">KP No:</label><input type="text" id="machining-filter-kp" class="form-input input-sm" placeholder="Search KP..."></div>
              <div class="filter-group"><label for="machining-filter-jc">JC No:</label><input type="text" id="machining-filter-jc" class="form-input input-sm" placeholder="Search JC..."></div>
              <div class="filter-group"><label for="machining-filter-customer">Customer:</label><input type="text" id="machining-filter-customer" class="form-input input-sm" placeholder="Search Customer..."></div>
              <div class="filter-group"><label for="machining-filter-machine">Machine:</label>
                <select id="machining-filter-machine" class="form-input select-sm"><option value="">All Machines</option>${opts(MACHINES)}</select></div>
              <div class="filter-group"><label for="machining-filter-process">Process:</label>
                <select id="machining-filter-process" class="form-input select-sm"><option value="">All Processes</option>${opts(PROCESSES)}</select></div>
              <button id="btn-machining-clear-filters" class="btn btn-secondary btn-sm" style="height:60px; min-width:120px;">CLEAR FILTERS</button>
            </div>
            <div id="machining-queue-cards" class="queue-cards-grid"></div>
          </div>
        </div>
      </div>

      <!-- ACTIVE JOB -->
      <div id="machining-subtab-active" class="machining-subtab-panel">
        <div class="split-layout">
          <div class="panel active-operation-panel grinding-active-monitor">
            <div class="panel-header header-alert">
              <h3>MODULE 02: ACTIVE MACHINING STATION MONITOR</h3>
              <div class="live-dot-pulse"><span class="pulse-dot"></span><span class="pulse-txt">MACHINING CYCLE</span></div>
            </div>
            <div class="panel-body">
              <div id="machining-no-active-job-message" class="no-selection-message">
                <p>NO ACTIVE MACHINING CYCLE SELECTED</p>
                <span class="sub-text">Select a job from the Queue sub-tab and tap "Start Machining", or pick a running cycle on the right.</span>
              </div>
              <div id="machining-active-job-timer-interface" class="timer-interface-grid" style="display:none;">
                <div class="job-meta-details">
                  <div class="meta-row"><span class="meta-label">KP NUMBER:</span><span id="machining-active-kp-no" class="font-bold text-cyan" style="font-size:18px;">-</span></div>
                  <div class="meta-row"><span class="meta-label">COMPONENT PART:</span><span id="machining-active-part-name" class="font-bold">-</span></div>
                  <div class="meta-row"><span class="meta-label">CUSTOMER:</span><span id="machining-active-customer" class="font-bold">-</span></div>
                  <div class="meta-row"><span class="meta-label">BATCH QUANTITY:</span><span id="machining-active-qty" class="font-bold font-mono text-cyan" style="font-size:18px;">0</span></div>
                  <div class="meta-row"><span class="meta-label">LATHE MACHINE:</span><span id="machining-active-machine" class="badge badge-normal font-bold" style="font-size:14px; padding:4px 8px;">-</span></div>
                  <div class="meta-row"><span class="meta-label">PROCESS:</span><span id="machining-active-process" class="badge badge-normal font-bold" style="font-size:14px; padding:4px 8px;">-</span></div>
                  <div class="meta-row"><span class="meta-label">OPERATOR:</span><span id="machining-active-operator" class="font-bold" style="font-size:18px; color:#facc15;">-</span></div>
                  <div class="meta-row"><span class="meta-label">CYCLE STATE:</span><span id="machining-active-status-badge" class="badge badge-progress" style="font-size:14px; padding:4px 8px;">STANDBY</span></div>
                </div>
                <div class="timer-display-box text-center">
                  <span class="meta-label">ELAPSED ACTIVE CYCLE RUNTIME</span>
                  <div class="digital-digits text-cyan" id="machining-timer-readout">00:00:00</div>
                  <div class="timer-secondary-metrics mt-1 text-muted" style="display:flex; justify-content:center; gap:30px;">
                    <div><span class="timer-sub-lbl">Start: </span><span class="font-mono text-xs" id="machining-time-started">--:--:--</span></div>
                    <div><span class="timer-sub-lbl">Paused Time: </span><span class="font-mono text-xs text-red" id="machining-time-paused-total">00:00:00</span></div>
                  </div>
                </div>
                <div class="form-group mt-1">
                  <label for="machining-remarks">Machining Remarks / Measurements (optional)</label>
                  <input type="text" id="machining-remarks" class="form-input" placeholder="Sizes, tool used, finish, observations...">
                </div>
                <div class="timer-actions-bar mt-1" style="display:flex; gap:15px; width:100%;">
                  <button type="button" class="btn btn-success btn-block glove-btn-lg" id="btn-machining-start-cycle" style="display:none;">START CYCLE</button>
                  <button type="button" class="btn btn-danger btn-block glove-btn-lg" id="btn-machining-pause-cycle" style="display:none;">PAUSE CYCLE</button>
                  <button type="button" class="btn btn-warning btn-block glove-btn-lg" id="btn-machining-resume-cycle" style="display:none;">RESUME CYCLE</button>
                  <button type="button" class="btn btn-primary btn-block glove-btn-lg" id="btn-machining-end-cycle" style="display:none;">END MACHINING</button>
                </div>
              </div>
            </div>
          </div>
          <div class="panel">
            <div class="panel-header"><h3>ACTIVE MACHINING CYCLES</h3></div>
            <div class="panel-body" style="max-height:500px; overflow-y:auto;">
              <div id="machining-active-job-cards-container" class="active-cards-list"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- HISTORY -->
      <div id="machining-subtab-history" class="machining-subtab-panel">
        <div class="panel">
          <div class="panel-header"><h3>MODULE 03: MACHINING JOB CHRONOLOGY LOG</h3></div>
          <div class="panel-body">
            <div class="filters-toolbar">
              <div class="filter-group"><label for="machining-hist-filter-kp">KP No:</label><input type="text" id="machining-hist-filter-kp" class="form-input input-sm" placeholder="Search KP..."></div>
              <div class="filter-group"><label for="machining-hist-filter-customer">Customer:</label><input type="text" id="machining-hist-filter-customer" class="form-input input-sm" placeholder="Search Customer..."></div>
              <div class="filter-group"><label for="machining-hist-filter-machine">Machine:</label>
                <select id="machining-hist-filter-machine" class="form-input select-sm"><option value="">All</option>${opts(MACHINES)}</select></div>
              <div class="filter-group"><label for="machining-hist-filter-operator">Operator:</label>
                <select id="machining-hist-filter-operator" class="form-input select-sm"><option value="">All</option>${opts(OPERATORS)}</select></div>
              <button id="btn-machining-clear-hist-filters" class="btn btn-secondary btn-sm" style="height:60px; min-width:120px;">CLEAR FILTERS</button>
            </div>
            <div style="overflow-x:auto;">
              <table class="data-table mt-1">
                <thead><tr><th>KP Number</th><th>Part Name</th><th>Customer</th><th>Qty</th><th>Lathe Machine</th><th>Process</th>
                  <th>Operator</th><th>Duration</th><th>Holds</th><th>Now In</th></tr></thead>
                <tbody id="machining-history-table-body"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
    main.appendChild(section);
  }

  function injectModals() {
    if ($("modal-start-machining")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="modal-start-machining" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header"><h3>Start Machining Operation</h3><button type="button" class="modal-close" data-close="modal-start-machining">&times;</button></div>
          <div class="modal-body">
            <p>Set up the machining cycle for <strong id="modal-machining-kp-display" class="text-cyan"></strong>.</p>
            <form id="machining-start-form" class="industrial-form mt-1">
              <div class="form-group">
                <label for="machining-machine-select" style="font-weight:bold; margin-bottom:5px; display:block;">Select Lathe Machine *</label>
                <select id="machining-machine-select" class="form-input" style="height:50px; font-size:16px; width:100%;" required>
                  <option value="">-- Choose Machine --</option>${opts(MACHINES)}</select>
              </div>
              <div class="form-group">
                <label for="machining-process-select" style="font-weight:bold; margin-bottom:5px; display:block;">Select Machining Process *</label>
                <select id="machining-process-select" class="form-input" style="height:50px; font-size:16px; width:100%;" required>${opts(PROCESSES, PROCESSES[0])}</select>
              </div>
              <div class="form-grid">
                <div class="form-group">
                  <label for="machining-operator-select" style="font-weight:bold; margin-bottom:5px; display:block;">Operator Name *</label>
                  <select id="machining-operator-select" class="form-input" style="height:50px; font-size:16px; width:100%;" required>
                    <option value="">-- Select Operator --</option>${opts(OPERATORS)}</select>
                </div>
                <div class="form-group">
                  <label for="machining-qty-input" style="font-weight:bold; margin-bottom:5px; display:block;">Job Qty (Nos) *</label>
                  <input type="number" id="machining-qty-input" min="1" class="form-input" style="height:50px; font-size:16px;" required>
                </div>
              </div>
              <div class="form-actions mt-1" style="flex-direction:column; gap:15px;">
                <button type="submit" class="btn btn-success btn-tablet-primary" style="height:60px; font-size:18px;">Start Machining Cycle</button>
                <button type="button" class="btn btn-secondary modal-cancel-btn" data-close="modal-start-machining" style="height:60px; font-size:16px; width:100%;">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div id="modal-pause-machining" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header"><h3>Pause Machining Operation</h3><button type="button" class="modal-close" data-close="modal-pause-machining">&times;</button></div>
          <div class="modal-body">
            <p>Select a reason to pause machining for <strong id="modal-pause-machining-kp-display" class="text-cyan"></strong>.</p>
            <form id="machining-pause-form" class="industrial-form mt-1">
              <div class="form-group">
                <label for="machining-pause-reason-select" style="font-weight:bold; margin-bottom:5px; display:block;">Select Hold Reason *</label>
                <select id="machining-pause-reason-select" class="form-input" style="height:60px; font-size:18px; width:100%;" required>
                  <option value="">-- Select Reason --</option>${opts(HOLD_REASONS)}</select>
              </div>
              <div class="form-group mt-1">
                <label for="machining-pause-remarks" style="font-weight:bold; margin-bottom:5px; display:block;">Hold Remarks</label>
                <input type="text" id="machining-pause-remarks" placeholder="Enter details..." class="form-input" style="height:60px; font-size:18px; width:100%;">
              </div>
              <div class="form-actions mt-1" style="flex-direction:column; gap:15px;">
                <button type="submit" class="btn btn-danger btn-tablet-primary" style="height:60px; font-size:18px;">Pause Cycle</button>
                <button type="button" class="btn btn-secondary modal-cancel-btn" data-close="modal-pause-machining" style="height:60px; font-size:16px; width:100%;">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div id="modal-complete-machining" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header"><h3>End Machining Operation</h3><button type="button" class="modal-close" data-close="modal-complete-machining">&times;</button></div>
          <div class="modal-body">
            <p>Complete machining for <strong id="modal-complete-machining-kp-display" class="text-cyan"></strong>. Next, drag the job card to its next stage.</p>
            <form id="machining-complete-form" class="industrial-form mt-1">
              <div class="form-group">
                <label for="machining-complete-qty" style="font-weight:bold; margin-bottom:5px; display:block;">Quantity Done in Machining *</label>
                <input type="number" id="machining-complete-qty" class="form-input" min="1" style="height:60px; font-size:18px; width:100%;" required>
                <span class="text-xs text-muted">If less than the full quantity, the done parts move on and the rest stay in Machining.</span>
              </div>
              <div class="form-actions mt-1" style="flex-direction:column; gap:15px;">
                <button type="submit" class="btn btn-success btn-tablet-primary" style="height:60px; font-size:18px;">Complete &amp; Choose Next Stage</button>
                <button type="button" class="btn btn-secondary modal-cancel-btn" data-close="modal-complete-machining" style="height:60px; font-size:16px; width:100%;">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
  }

  // ===================== RENDERING =====================
  function machiningJobs() {
    return allJobs().filter(j => j.currentDepartment === STAGE);
  }

  function renderKpis() {
    const inStage = machiningJobs();
    inStage.forEach(ensureMachining);
    const pending = inStage.filter(j => j.machining.status === "Pending").length;
    const running = inStage.filter(j => j.machining.status === "In Progress" || j.machining.status === "Hold");
    const machinesBusy = new Set(running.filter(j => j.machining.status === "In Progress").map(j => j.machining.machineName).filter(Boolean));
    const completed = allJobs().filter(j => j.machining && j.machining.status === "Completed");
    const durations = completed.map(j => Number(j.machining.durationMs || j.machining.activeTimeMs || 0)).filter(Boolean);
    const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("machining-kpis-pending", pending);
    set("machining-kpis-running", running.length);
    set("machining-kpis-machines", machinesBusy.size);
    set("machining-kpis-completed", completed.length);
    set("machining-kpis-avgtime", fmt(avg));
  }

  function renderQueue() {
    const box = $("machining-queue-cards");
    if (!box) return;
    const fKp = ($("machining-filter-kp").value || "").toLowerCase();
    const fJc = ($("machining-filter-jc").value || "").toLowerCase();
    const fCust = ($("machining-filter-customer").value || "").toLowerCase();
    const fMach = $("machining-filter-machine").value;
    const fProc = $("machining-filter-process").value;

    const list = machiningJobs().filter(j => {
      const m = ensureMachining(j);
      if (m.status === "Completed") return false;
      const jc = (typeof getJobJcNo === "function") ? getJobJcNo(j) : (j.jcNo || "");
      if (fKp && !String(j.kpNumber).toLowerCase().includes(fKp)) return false;
      if (fJc && !String(jc).toLowerCase().includes(fJc)) return false;
      if (fCust && !String(j.customer || "").toLowerCase().includes(fCust)) return false;
      if (fMach && m.machineName !== fMach) return false;
      if (fProc && m.processType !== fProc) return false;
      return true;
    });

    if (!list.length) {
      box.innerHTML = `<div class="no-selection-message" style="grid-column:1 / -1; width:100%;">No jobs in the Machining queue.</div>`;
      return;
    }

    box.innerHTML = "";
    const ro = isReadOnly();
    list.forEach(job => {
      const m = job.machining;
      const card = document.createElement("div");
      card.className = "stage-kanban-card";
      if (typeof getTATUrgency === "function") {
        const u = getTATUrgency(job);
        if (u === "warning") card.classList.add("job-card-tat-warning");
        else if (u === "critical") card.classList.add("job-card-tat-critical");
      }
      const statusClass = m.status === "In Progress" ? "badge-progress" : (m.status === "Hold" ? "badge-hold" : "badge-pending");
      const action = ro ? "" : (m.status === "Pending"
        ? `<button class="btn btn-success btn-xs" style="width:100%; height:32px;" data-mach-start="${esc(job.kpNumber)}">START MACHINING</button>`
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
          <div class="job-card-row"><span class="job-card-label">Machine:</span><span class="job-card-value">${esc(m.machineName || "Unassigned")}</span></div>
          <div class="job-card-row"><span class="job-card-label">Process:</span><span class="job-card-value">${esc(m.processType || "Unassigned")}</span></div>
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
    const iface = $("machining-active-job-timer-interface");
    const empty = $("machining-no-active-job-message");
    const job = selectedKp ? allJobs().find(j => j.kpNumber === selectedKp) : null;
    if (!job || job.currentDepartment !== STAGE || ensureMachining(job).status === "Completed") {
      selectedKp = null;
      if (iface) iface.style.display = "none";
      if (empty) empty.style.display = "flex";
      return;
    }
    const m = job.machining;
    if (empty) empty.style.display = "none";
    if (iface) iface.style.display = "flex";

    $("machining-active-kp-no").textContent = kpLabel(job);
    $("machining-active-part-name").textContent = job.partName || "-";
    $("machining-active-customer").textContent = job.customer || "-";
    $("machining-active-qty").innerHTML = qtyLabel(job);
    $("machining-active-machine").textContent = m.machineName || "Unassigned";
    $("machining-active-process").textContent = m.processType || "Unassigned";
    $("machining-active-operator").textContent = m.operatorName || "-";
    const remarks = $("machining-remarks");
    if (remarks && document.activeElement !== remarks) remarks.value = m.remarks || "";

    const badge = $("machining-active-status-badge");
    badge.className = "badge";
    if (m.status === "In Progress") { badge.classList.add("badge-progress"); badge.textContent = "RUNNING"; }
    else if (m.status === "Hold") { badge.classList.add("badge-hold"); badge.textContent = "ON HOLD"; }
    else { badge.classList.add("badge-normal"); badge.textContent = "STANDBY"; }

    const ro = isReadOnly();
    const show = (id, on) => { const b = $(id); if (b) b.style.display = (on && !ro) ? "flex" : "none"; };
    show("btn-machining-start-cycle", m.status === "Pending");
    show("btn-machining-pause-cycle", m.status === "In Progress");
    show("btn-machining-resume-cycle", m.status === "Hold");
    show("btn-machining-end-cycle", m.status === "In Progress" || m.status === "Hold");

    updateTimerReadout(job);
  }

  function updateTimerReadout(job) {
    const m = ensureMachining(job);
    const readout = $("machining-timer-readout");
    if (readout) readout.textContent = fmt(runningMs(m));
    const started = $("machining-time-started");
    if (started) started.textContent = m.startTime
      ? new Date(m.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--";
    const paused = $("machining-time-paused-total");
    if (paused) {
      const pausedMs = m.startTime ? Math.max(0, (Date.now() - new Date(m.startTime).getTime()) - runningMs(m)) : 0;
      paused.textContent = fmt(pausedMs);
    }
  }

  function renderActiveCards() {
    const box = $("machining-active-job-cards-container");
    if (!box) return;
    const list = machiningJobs().filter(j => { const s = ensureMachining(j).status; return s === "In Progress" || s === "Hold"; });
    if (!list.length) {
      box.innerHTML = `<div class="no-selection-message">No running machining cycles on the shop floor.</div>`;
      return;
    }
    box.innerHTML = "";
    list.forEach(job => {
      const m = job.machining;
      const card = document.createElement("div");
      card.className = "active-card" + (job.kpNumber === selectedKp ? " selected-card" : "");
      card.addEventListener("click", () => { selectedKp = job.kpNumber; renderMachiningDashboard(); });
      card.innerHTML = `
        <div class="card-left">
          <div class="card-kp-row"><span class="card-kp">${esc(kpLabel(job))}</span>
            <span class="badge ${m.status === "Hold" ? "badge-hold" : "badge-progress"} text-xs">${esc(m.status)}</span></div>
          <span class="card-part">${esc(job.partName)} (${qtyLabel(job)})</span>
          <span class="card-op-info">${esc(m.machineName || "-")} · ${esc(m.operatorName || "-")}</span>
        </div>
        <div class="card-right"><span class="card-time font-mono" data-mach-timer="${esc(job.kpNumber)}">${fmt(runningMs(m))}</span>
          <span class="text-xs text-muted">Active Run</span></div>`;
      box.appendChild(card);
    });
  }

  function renderHistory() {
    const tbody = $("machining-history-table-body");
    if (!tbody) return;
    const fKp = ($("machining-hist-filter-kp").value || "").toLowerCase();
    const fCust = ($("machining-hist-filter-customer").value || "").toLowerCase();
    const fMach = $("machining-hist-filter-machine").value;
    const fOp = $("machining-hist-filter-operator").value;
    const list = allJobs().filter(j => {
      const m = j.machining;
      if (!m || m.status !== "Completed") return false;
      if (fKp && !String(j.kpNumber).toLowerCase().includes(fKp)) return false;
      if (fCust && !String(j.customer || "").toLowerCase().includes(fCust)) return false;
      if (fMach && m.machineName !== fMach) return false;
      if (fOp && m.operatorName !== fOp) return false;
      return true;
    }).sort((a, b) => String(b.machining.endTime || "").localeCompare(String(a.machining.endTime || "")));

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">No completed machining records.</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(j => {
      const m = j.machining;
      const holds = Array.isArray(m.holdHistory) ? m.holdHistory.length : 0;
      return `<tr>
        <td class="font-mono font-bold text-cyan">${esc(j.kpNumber)}</td>
        <td>${esc(j.partName)}</td><td>${esc(j.customer)}</td>
        <td class="font-mono">${esc(m.quantity || j.quantity)}</td>
        <td>${esc(m.machineName || "-")}</td><td>${esc(m.processType || "-")}</td><td>${esc(m.operatorName || "-")}</td>
        <td class="font-mono">${fmt(m.durationMs || m.activeTimeMs)}</td><td>${holds}</td>
        <td><strong>${esc(j.currentDepartment || "-")}</strong></td></tr>`;
    }).join("");
  }

  function renderMachiningDashboard() {
    renderKpis();
    if (activeSubtab === "machining-subtab-queue") renderQueue();
    else if (activeSubtab === "machining-subtab-active") { renderActiveStation(); renderActiveCards(); }
    else if (activeSubtab === "machining-subtab-history") renderHistory();
  }
  window.renderMachiningDashboard = renderMachiningDashboard;

  function switchSubtab(id) {
    activeSubtab = id;
    document.querySelectorAll("#tab-machining .machining-tab-btn").forEach(b => b.classList.toggle("active", b.getAttribute("data-subtab") === id));
    document.querySelectorAll("#tab-machining .machining-subtab-panel").forEach(p => p.classList.toggle("active", p.id === id));
    renderMachiningDashboard();
  }

  function updateBadge() {
    const b = $("badge-count-machining");
    if (b) b.textContent = machiningJobs().length;
  }

  // ===================== ACTIONS =====================
  function openModal(id) { const m = $(id); if (m) m.classList.add("active"); }
  function closeModal(id) { const m = $(id); if (m) m.classList.remove("active"); }

  function openStartModal(kp) {
    const job = allJobs().find(j => j.kpNumber === kp);
    if (!job) return;
    selectedKp = kp;
    $("modal-machining-kp-display").textContent = kp;
    $("machining-machine-select").value = "";
    $("machining-process-select").value = PROCESSES[0];
    $("machining-operator-select").value = "";
    $("machining-qty-input").value = job.quantity;
    openModal("modal-start-machining");
  }

  function submitStart(e) {
    e.preventDefault();
    const kp = $("modal-machining-kp-display").textContent;
    const machine = $("machining-machine-select").value;
    const process = $("machining-process-select").value;
    const operator = $("machining-operator-select").value;
    const qty = parseInt($("machining-qty-input").value, 10);
    if (!machine || !operator) { alert("Please select the lathe machine and the operator."); return; }
    const busy = machiningJobs().find(j => j.kpNumber !== kp && j.machining && j.machining.status === "In Progress" && j.machining.machineName === machine);
    if (busy && !confirm(`${machine} is already running ${busy.kpNumber}. Start this job on it anyway?`)) return;

    const job = allJobs().find(j => j.kpNumber === kp);
    if (!job) return;
    const m = ensureMachining(job);
    const now = new Date().toISOString();
    Object.assign(m, { status: "In Progress", machineName: machine, processType: process, operatorName: operator,
                       quantity: qty || job.quantity, startTime: now, lastStartedAt: now, activeTimeMs: 0, holdHistory: [] });
    job.status = "In Progress";
    selectedKp = kp;
    closeModal("modal-start-machining");
    switchSubtab("machining-subtab-active");
    renderAll();
    audit(kp, `Started Machining (${process}) on ${machine}, operator ${operator}`);
    syncToServer({ type: "START_CYCLE", kpNo: kp, stage: STAGE, operatorName: operator, startTime: now,
                   machineName: machine, processType: process, quantity: qty || job.quantity }, "machining start");
  }

  function openPauseModal() {
    if (!selectedKp) return;
    $("modal-pause-machining-kp-display").textContent = selectedKp;
    $("machining-pause-reason-select").value = "";
    $("machining-pause-remarks").value = "";
    openModal("modal-pause-machining");
  }

  function submitPause(e) {
    e.preventDefault();
    const reason = $("machining-pause-reason-select").value;
    const remarks = $("machining-pause-remarks").value;
    if (!reason) { alert("Please select a hold reason."); return; }
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    const m = ensureMachining(job);
    if (m.status !== "In Progress") { closeModal("modal-pause-machining"); return; }
    const now = new Date().toISOString();
    m.activeTimeMs = runningMs(m);
    m.status = "Hold";
    m.lastPausedAt = now;
    m.lastStartedAt = null;
    m.holdHistory.push({ holdTime: now, resumeTime: null, reason, remarks });
    job.status = "Hold";
    closeModal("modal-pause-machining");
    renderAll();
    audit(job.kpNumber, `Paused Machining. Reason: ${reason}. ${remarks}`);
    syncToServer({ type: "PAUSE_CYCLE", kpNo: job.kpNumber, stage: STAGE, operatorName: m.operatorName,
                   activeTimeMs: m.activeTimeMs, holdHistory: m.holdHistory, holdReason: reason, remarks }, "machining pause");
  }

  function resumeCycle() {
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    const m = ensureMachining(job);
    if (m.status !== "Hold") return;
    const now = new Date().toISOString();
    m.status = "In Progress";
    m.lastStartedAt = now;
    const last = m.holdHistory[m.holdHistory.length - 1];
    if (last && !last.resumeTime) last.resumeTime = now;
    job.status = "In Progress";
    renderAll();
    audit(job.kpNumber, "Resumed Machining");
    syncToServer({ type: "RESUME_CYCLE", kpNo: job.kpNumber, stage: STAGE, operatorName: m.operatorName,
                   holdHistory: m.holdHistory }, "machining resume");
  }

  function openCompleteModal() {
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    $("modal-complete-machining-kp-display").textContent = kpLabel(job);
    const q = $("machining-complete-qty");
    q.value = job.quantity;
    q.max = job.quantity;
    openModal("modal-complete-machining");
  }

  function submitComplete(e) {
    e.preventDefault();
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    const m = ensureMachining(job);
    const doneQty = parseInt($("machining-complete-qty").value, 10);
    if (isNaN(doneQty) || doneQty <= 0 || doneQty > job.quantity) {
      alert(`Please enter a valid quantity done (1 to ${job.quantity}).`);
      return;
    }
    const remarksEl = $("machining-remarks");
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
          machineName: m.machineName, processType: m.processType, remarks: m.remarks,
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
    closeModal("modal-complete-machining");
    audit(job.kpNumber, `Completed Machining (${doneQty}/${job.quantity} pcs) on ${m.machineName || "-"}`);
    showFloatingCardTransition(job, STAGE, payloadGenerator, applyLocalMutation);
  }


  // ===================== INSPECTION PAGE STAGE BOARD =====================
  // Turns the 5-column board on the Inspection page into a real stage board:
  // INSPECTION | MACHINING | MASKING | SPRAYING | GRINDING | POLISHING (jobs actually in each stage).
  const BOARD_COLUMNS = [
    { stage: "Inspection", tab: "inspection", cards: "cards-intake",           count: "count-intake" },
    { stage: "Machining",  tab: "machining",  cards: "cards-machining-stage",  count: "count-machining-stage" },
    { stage: "Masking",    tab: "masking",    cards: "cards-visual",           count: "count-visual" },
    { stage: "Spraying",   tab: "spraying",   cards: "cards-dimensional",      count: "count-dimensional" },
    { stage: "Grinding",   tab: "grinding",   cards: "cards-review",           count: "count-review" },
    { stage: "Polishing",  tab: "polishing",  cards: "cards-ready",            count: "count-ready" }
  ];

  function setupStageBoard() {
    const board = document.querySelector(".inspection-kanban-board");
    const first = $("cards-intake");
    if (!board || !first || $("cards-machining-stage")) return;
    board.style.gridTemplateColumns = "repeat(6, minmax(0, 1fr))";

    // Insert the MACHINING column right after INSPECTION
    const firstCol = first.closest(".kanban-column");
    const col = document.createElement("div");
    col.className = "kanban-column";
    col.setAttribute("data-status", "Machining");
    col.innerHTML = `<div class="kanban-column-header" style="border-color:#64748b;">
        <span class="column-title">MACHINING</span><span class="column-count" id="count-machining-stage">0</span></div>
      <div class="kanban-cards-container" id="cards-machining-stage"></div>`;
    firstCol.insertAdjacentElement("afterend", col);

    // Stage names as column titles; switch off the old sub-step drag & drop
    BOARD_COLUMNS.forEach(c => {
      const box = $(c.cards);
      if (!box) return;
      const title = box.closest(".kanban-column").querySelector(".column-title");
      if (title) title.textContent = c.stage.toUpperCase();
      ["ondrop", "ondragover", "ondragleave"].forEach(a => box.removeAttribute(a));
    });

    // Drag an Inspection card onto another column = push the job to that stage
    board.addEventListener("dragstart", e => {
      const card = e.target.closest && e.target.closest("[data-board-kp]");
      if (!card) return;
      boardDragging = true;
      e.dataTransfer.setData("text/plain", card.getAttribute("data-board-kp"));
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    board.addEventListener("dragend", e => {
      const card = e.target.closest && e.target.closest("[data-board-kp]");
      if (card) card.classList.remove("dragging");
      board.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
      boardDragging = false;
      setTimeout(() => { try { renderStageBoard(); } catch (err) {} }, 50);
    });
    BOARD_COLUMNS.forEach(c => {
      const box = $(c.cards);
      if (!box) return;
      const column = box.closest(".kanban-column");
      column.addEventListener("dragover", e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        box.classList.add("drag-over");
      });
      column.addEventListener("dragleave", e => {
        if (!column.contains(e.relatedTarget)) box.classList.remove("drag-over");
      });
      column.addEventListener("drop", e => {
        e.preventDefault();
        box.classList.remove("drag-over");
        boardDragging = false;
        const kp = e.dataTransfer.getData("text/plain");
        console.log("[Machining] Board drop:", kp, "→", c.stage);
        const job = kp && allJobs().find(j => j.kpNumber === kp);
        if (!job || job.currentDepartment === c.stage) return;
        if (job.currentDepartment === "Inspection") pushFromInspection(job, c.stage);
        else moveJobOnBoard(job, c.stage);
      });
    });

    board.addEventListener("click", e => {
      const push = e.target.closest("[data-board-push]");
      const open = e.target.closest("[data-board-open]");
      if (push && typeof triggerInspectionFloatingTransition === "function") triggerInspectionFloatingTransition(push.getAttribute("data-board-push"));
      if (open) window.location.hash = "#/" + open.getAttribute("data-board-open");
    });
  }

  function pushFromInspection(job, targetStage) {
    if (typeof applyStageTransitionWithUndo !== "function") {
      if (typeof triggerInspectionFloatingTransition === "function") triggerInspectionFloatingTransition(job.kpNumber);
      return;
    }
    const operator = (typeof getLoggedUser === "function" && getLoggedUser() && getLoggedUser().name) || ((user() && user().email) || "Inspector");
    window.pendingTransition = {
      job: job,
      stage: "Inspection",
      payloadGenerator: nextStage => ({
        type: "APPROVE_JOB", kpNo: job.kpNumber, stage: "Inspection",
        nextStage: nextStage, operatorName: operator, time: new Date().toISOString()
      }),
      applyLocalMutation: nextStage => {
        if (typeof transitionToStage === "function") transitionToStage(job, nextStage, operator);
        else { job.currentDepartment = nextStage; job.status = "Pending"; }
      }
    };
    applyStageTransitionWithUndo(targetStage);
  }

  // Field name of each stage's data on the job ("Final Inspection" is stored as finalInspection)
  const stageKeyOf = stage => {
    const k = String(stage || "").toLowerCase().replace(/[^a-z]/g, "");
    return k === "finalinspection" ? "finalInspection" : k;
  };

  // Move a job from any stage to any other stage (forward or backward) from the board
  function moveJobOnBoard(job, targetStage) {
    if (typeof applyStageTransitionWithUndo !== "function") return;
    const fromStage = job.currentDepartment;
    const fromKey = stageKeyOf(fromStage);
    const fromData = job[fromKey] || {};
    const running = fromData.status === "In Progress" || fromData.status === "Hold";
    if (running && !confirm(`${job.kpNumber} is currently ${fromData.status} in ${fromStage}.\nMoving it will stop that cycle.\n\nMove to ${targetStage} anyway?`)) return;

    const operator = (typeof getLoggedUser === "function" && getLoggedUser() && getLoggedUser().name) || ((user() && user().email) || "Supervisor");
    window.pendingTransition = {
      job: job,
      stage: fromStage,
      payloadGenerator: nextStage => ({
        type: "MOVE_STAGE", kpNo: job.kpNumber, stage: fromStage, nextStage: nextStage,
        operatorName: operator, stopRunningCycle: running, time: new Date().toISOString()
      }),
      applyLocalMutation: nextStage => {
        if (running && job[fromKey]) { job[fromKey].status = "Pending"; job[fromKey].lastStartedAt = null; }
        if (typeof transitionToStage === "function") transitionToStage(job, nextStage, operator);
        else { job.currentDepartment = nextStage; job.status = "Pending"; }
        if (selectedKp === job.kpNumber) selectedKp = null;
      }
    };
    applyStageTransitionWithUndo(targetStage);
  }

  // Firebase save for MOVE_STAGE (the app's own save function has no "move anywhere" step)
  async function saveMoveStage(payload) {
    const db = firebase.firestore();
    const snap = await db.collection("jobs").where("kpNumber", "==", payload.kpNo).get();
    if (snap.empty) throw new Error(`Job ${payload.kpNo} not found`);
    const ref = snap.docs[0].ref;
    const data = snap.docs[0].data();
    const nowIso = new Date().toISOString();
    const target = payload.nextStage;
    const tKey = stageKeyOf(target);
    const fKey = stageKeyOf(payload.stage);

    const targetData = Object.assign({}, data[tKey] || {}, {
      status: target === "Dispatched" ? "Completed" : "Pending",
      queueEntryTime: nowIso, lastStartedAt: null, startTime: null, endTime: null,
      activeTimeMs: 0, holdHistory: []
    });
    if (tKey === "masking" && !Array.isArray(targetData.materials)) targetData.materials = [];

    const updates = {
      currentStage: target,
      currentStatus: target === "Dispatched" ? "Completed" : "Pending",
      assignedOperator: null,
      shift: "",
      splitRemark: "",
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
      [tKey]: targetData,
      [`stageAssignedAt.${String(target).toLowerCase().replace(/[^a-z]/g, "")}`]: nowIso
    };
    if (payload.stopRunningCycle && fKey && fKey !== tKey && data[fKey]) {
      updates[fKey] = Object.assign({}, data[fKey], { status: "Pending", lastStartedAt: null });
    }
    if (payload.reworkReasonCategory) {
      updates.lastRework = { from: payload.stage, to: target, reason: payload.reworkReasonCategory,
                             comments: payload.reworkReasonComments || "", by: payload.operatorName || "", time: nowIso };
    }
    await ref.update(updates);
    return { success: true };
  }

  function stageStatus(job, stage) {
    const key = stage.toLowerCase().replace(/[^a-z]/g, "");
    return (job[key] && job[key].status) || job.status || "Pending";
  }

  function renderStageBoard() {
    if (!$("cards-machining-stage") || boardDragging) return;
    const ro = isReadOnly();
    BOARD_COLUMNS.forEach(c => {
      const box = $(c.cards);
      const cnt = $(c.count);
      if (!box) return;
      const list = allJobs().filter(j => j.currentDepartment === c.stage);
      if (cnt) cnt.textContent = list.length;
      if (!list.length) { box.innerHTML = `<div class="text-xs text-muted" style="text-align:center; padding:12px;">No jobs</div>`; return; }
      box.innerHTML = list.map(job => {
        const st = stageStatus(job, c.stage);
        const badge = st === "In Progress" ? "background:#3b82f6;" : (st === "Hold" ? "background:#ef4444;" : "background:#f97316;");
        const action = c.stage === "Inspection"
          ? (ro ? "" : `<button class="btn btn-secondary btn-xs" style="width:100%; height:28px; font-size:10px;" data-board-push="${esc(job.kpNumber)}">→ Move to Next Stage</button>`)
          : `<button class="btn btn-secondary btn-xs" style="width:100%; height:28px; font-size:10px;" data-board-open="${c.tab}">→ Open ${esc(c.stage)} Stage</button>`;
        const draggable = !ro;
        return `<div class="kanban-card" ${draggable ? `draggable="true" data-board-kp="${esc(job.kpNumber)}" style="cursor:grab;"` : ""}>
            <div class="kanban-card-header">
              <span class="kanban-card-kp">${esc(kpLabel(job))}</span>
              <span class="kanban-card-priority ${esc(String(job.priority || "Normal").toLowerCase())}" title="Priority: ${esc(job.priority || "Normal")}"></span>
            </div>
            <div class="kanban-card-part">${esc(job.partName || "—")}</div>
            <div class="kanban-card-cust">${esc(job.customer || "—")}</div>
            <div class="kanban-card-footer">
              <span class="kanban-card-qty">${esc(job.quantity || "—")} pcs</span>
              <span style="font-size:10px; font-weight:700; padding:2px 10px; border-radius:4px; color:#fff; ${badge}">${esc(String(st).toUpperCase())}</span>
            </div>
            <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column; gap:4px;">
              ${action}
              ${c.stage === "Inspection" && typeof buildDeleteJobButtonHTML === "function" ? buildDeleteJobButtonHTML(job.kpNumber) : ""}
            </div>
          </div>`;
      }).join("");
    });
  }

  // ===================== HOOKS INTO THE EXISTING APP =====================
  function installHooks() {
    // Permissions: who can open the Machining tab
    if (typeof ROLE_PERMISSIONS !== "undefined") {
      ["super_admin", "production_admin", "hr_admin"].forEach(r => {
        const list = ROLE_PERMISSIONS[r];
        if (Array.isArray(list) && !list.includes("tab-machining")) list.splice(list.indexOf("tab-inspection") + 1, 0, "tab-machining");
      });
      if (ROLE_PERMISSIONS.operator && !ROLE_PERMISSIONS.operator.Machining) {
        ROLE_PERMISSIONS.operator.Machining = ["tab-machining", "tab-reports"];
      }
    }

    // Machining operators land on the Machining tab after login
    if (typeof window.getDefaultTab === "function") {
      const orig = window.getDefaultTab;
      window.getDefaultTab = function () {
        const u = user();
        if (u && u.role === "operator" && String(u.department || "").toLowerCase().includes("machin")) return "tab-machining";
        return orig.apply(this, arguments);
      };
    }

    // Render the tab and the sidebar badge with every app refresh
    if (typeof window.executeRenderAll === "function") {
      const orig = window.executeRenderAll;
      window.executeRenderAll = function () {
        const r = orig.apply(this, arguments);
        try {
          updateBadge();
          const pane = $("tab-machining");
          if (pane && pane.classList.contains("active")) renderMachiningDashboard();
        } catch (e) { console.warn("[Machining] render error:", e); }
        return r;
      };
    }

    // Jobs pushed into Machining get a fresh machining record
    if (typeof window.transitionToStage === "function") {
      const orig = window.transitionToStage;
      window.transitionToStage = function (job, stageName) {
        const r = orig.apply(this, arguments);
        if (stageName === STAGE && job) {
          job.machining = { status: "Pending", machineName: "", processType: "", operatorName: "", quantity: job.quantity,
                            startTime: null, endTime: null, lastStartedAt: null, lastPausedAt: null,
                            activeTimeMs: 0, durationMs: 0, holdHistory: [], remarks: "" };
        }
        return r;
      };
    }

    // Handle MOVE_STAGE saves; every other save goes to the app's normal save function
    if (typeof window.sendBackendPost === "function") {
      const origSend = window.sendBackendPost;
      window.sendBackendPost = async function (payload) {
        if (payload && String(payload.type || "").toUpperCase() === "MOVE_STAGE") {
          if (typeof isMockMode === "function" && isMockMode()) return { success: true };
          return saveMoveStage(payload);
        }
        return origSend.apply(this, arguments);
      };
    }

    // Inspection page board shows the real stages (keeps the admin tracking table from the original)
    if (typeof window.renderInspectionDashboard === "function") {
      const orig = window.renderInspectionDashboard;
      window.renderInspectionDashboard = function () {
        const r = orig.apply(this, arguments);
        try { renderStageBoard(); } catch (e) { console.warn("[Machining] stage board error:", e); }
        return r;
      };
    }

    // Moving a job back from Masking etc. to Machining asks for a rework reason, like other stages
    if (typeof window.isBackwardTransition === "function") {
      window.isBackwardTransition = function (currentStage, targetStage) {
        const a = STAGE_ORDER.indexOf(currentStage), b = STAGE_ORDER.indexOf(targetStage);
        if (a === -1 || b === -1) return false;
        return b < a;
      };
    }
  }

  function bindEvents() {
    document.querySelectorAll("#tab-machining .machining-tab-btn").forEach(b =>
      b.addEventListener("click", () => switchSubtab(b.getAttribute("data-subtab"))));

    ["machining-filter-kp", "machining-filter-jc", "machining-filter-customer"].forEach(id => $(id).addEventListener("input", renderQueue));
    ["machining-filter-machine", "machining-filter-process"].forEach(id => $(id).addEventListener("change", renderQueue));
    $("btn-machining-clear-filters").addEventListener("click", () => {
      ["machining-filter-kp", "machining-filter-jc", "machining-filter-customer", "machining-filter-machine", "machining-filter-process"].forEach(id => { $(id).value = ""; });
      renderQueue();
    });
    ["machining-hist-filter-kp", "machining-hist-filter-customer"].forEach(id => $(id).addEventListener("input", renderHistory));
    ["machining-hist-filter-machine", "machining-hist-filter-operator"].forEach(id => $(id).addEventListener("change", renderHistory));
    $("btn-machining-clear-hist-filters").addEventListener("click", () => {
      ["machining-hist-filter-kp", "machining-hist-filter-customer", "machining-hist-filter-machine", "machining-hist-filter-operator"].forEach(id => { $(id).value = ""; });
      renderHistory();
    });

    $("machining-queue-cards").addEventListener("click", e => {
      const start = e.target.closest("[data-mach-start]");
      const view = e.target.closest("[data-mach-view]");
      if (start) openStartModal(start.getAttribute("data-mach-start"));
      if (view) { selectedKp = view.getAttribute("data-mach-view"); switchSubtab("machining-subtab-active"); }
    });

    $("btn-machining-start-cycle").addEventListener("click", () => { if (selectedKp) openStartModal(selectedKp); });
    $("btn-machining-pause-cycle").addEventListener("click", openPauseModal);
    $("btn-machining-resume-cycle").addEventListener("click", resumeCycle);
    $("btn-machining-end-cycle").addEventListener("click", openCompleteModal);

    $("machining-start-form").addEventListener("submit", submitStart);
    $("machining-pause-form").addEventListener("submit", submitPause);
    $("machining-complete-form").addEventListener("submit", submitComplete);
    document.querySelectorAll("[data-close]").forEach(b => {
      if (b.getAttribute("data-close").indexOf("machining") !== -1) b.addEventListener("click", () => closeModal(b.getAttribute("data-close")));
    });

    // Live timers once a second while the Machining tab is open
    setInterval(() => {
      const pane = $("tab-machining");
      if (!pane || !pane.classList.contains("active")) return;
      if (selectedKp) {
        const job = allJobs().find(j => j.kpNumber === selectedKp);
        if (job && job.machining) updateTimerReadout(job);
      }
      document.querySelectorAll("[data-mach-timer]").forEach(el => {
        const job = allJobs().find(j => j.kpNumber === el.getAttribute("data-mach-timer"));
        if (job && job.machining) el.textContent = fmt(runningMs(job.machining));
      });
    }, 1000);
  }

  // ===================== BOOT =====================
  // Runs while the page is still loading, so the existing init (nav permissions, drag targets)
  // picks up the injected Machining elements.
  try {
    injectStyles();
    injectSidebarButton();
    injectTab();
    injectModals();
    injectDropZone();
    injectUserDeptOption();
    setupStageBoard();
    installHooks();
    bindEvents();
    console.log("[Machining] Department module v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[Machining] Failed to load module:", err);
  }
})();