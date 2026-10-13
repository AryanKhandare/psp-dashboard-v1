/**
 * PSP MES – Polishing Department (full module, same layout as Grinding / Machining).
 *
 * Replaces the simple Polishing queue with: summary cards, Queue / Active Job / History sub-tabs,
 * Start (Pre / Final Polishing, operator, qty, store location), Pause with hold reason, Resume,
 * End Polishing (quantity done → drag card to the next stage, partial quantity splits the job).
 * Keeps "Complete & Push Job" on queue cards as a quick option without the timer.
 *
 * Uses the app's own saves (START_CYCLE / PAUSE_CYCLE / RESUME_CYCLE / END_CYCLE / SPLIT_STAGE).
 * Load after psp-common.js and machining.js (reuses its sub-tab styles), before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] polishing: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user, isReadOnly, fmt, kpLabel, qtyLabel } = window.PSP;
  const MODULE_VERSION = 1;

  // ===================== CONFIG =====================
  const STAGE = "Polishing";
  const PROCESSES = ["Pre Polishing", "Final Polishing"];
  const LOCATIONS = ["C-20/4", "B-37"];
  const HOLD_REASONS = ["Material Shortage", "Operator Unavailable", "Machine Issue", "Quality Issue", "Customer Hold", "Other"];

  let selectedKp = null;
  let activeSubtab = "polishing-mod-queue";

  const P = id => $("polishing-mod-" + id);

  function ensurePolishing(job) {
    if (!job.polishing || typeof job.polishing !== "object") job.polishing = {};
    const m = job.polishing;
    if (!m.status) m.status = "Pending";
    if (!Array.isArray(m.holdHistory)) m.holdHistory = [];
    return m;
  }

  function runningMs(m) {
    let ms = Number(m.activeTimeMs || 0);
    if (m.status === "In Progress" && m.lastStartedAt) ms += Date.now() - new Date(m.lastStartedAt).getTime();
    return ms;
  }

  // Pre / Final for a job: the operator's choice, else worked out from spraying (same rule as the badges)
  function phaseLabel(job) {
    if (window.PSPProcessPhase && window.PSPProcessPhase.phaseOf) {
      const ph = window.PSPProcessPhase.phaseOf(job, STAGE);
      if (ph) return ph;
    }
    const chosen = job.polishing && job.polishing.processType;
    if (PROCESSES.includes(chosen)) return { label: chosen, isPost: chosen === PROCESSES[1], auto: false };
    const sprayed = !!(job.spraying && job.spraying.status === "Completed");
    return { label: sprayed ? PROCESSES[1] : PROCESSES[0], isPost: sprayed, auto: true };
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
        console.error(`[Polishing] Failed to sync ${label}:`, err);
        alert(`Could not save ${label} for ${payload.kpNo}: ${err && err.message ? err.message : err}`);
      });
  }

  function audit(kp, msg) {
    try { if (typeof createAuditLog === "function") createAuditLog((user() && user().email) || "Operator", kp, msg); } catch (e) {}
  }

  function knownOperators() {
    const names = new Set();
    allJobs().forEach(j => { if (j.polishing && j.polishing.operatorName) names.add(String(j.polishing.operatorName).trim()); });
    const u = user();
    if (u && u.role === "operator" && u.name) names.add(u.name);
    return [...names].filter(Boolean).sort();
  }

  // ===================== UI =====================
  function injectTab() {
    const sec = $("tab-polishing");
    if (!sec || P("queue")) return;
    // Remove the old simple queue panel (the app's renderer then has nowhere to draw and stops)
    const oldBox = $("polishing-queue-cards");
    const oldPanel = oldBox && oldBox.closest(".panel");
    if (oldPanel) oldPanel.remove();

    // Same heading style as the other stages (the stage number changed when Machining was added)
    const h2 = sec.querySelector(".section-header h2");
    if (h2) h2.textContent = "POLISHING DEPARTMENT CONTROL PANEL";
    const desc = sec.querySelector(".section-header .section-desc");
    if (desc) desc.textContent = "Track pre and final polishing cycles, operators, hold time and surface finish (Ra) remarks.";

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="grinding-kpis-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
        <div class="metric-card"><span class="metric-val text-orange" id="polishing-mod-kpi-pending">0</span><span class="metric-lbl">Pending Jobs</span></div>
        <div class="metric-card"><span class="metric-val text-blue" id="polishing-mod-kpi-running">0</span><span class="metric-lbl">Running Jobs</span></div>
        <div class="metric-card"><span class="metric-val text-green" id="polishing-mod-kpi-completed">0</span><span class="metric-lbl">Completed Jobs</span></div>
        <div class="metric-card"><span class="metric-val font-mono" id="polishing-mod-kpi-avg" style="font-size:24px !important;">00:00:00</span><span class="metric-lbl">Average Cycle Time</span></div>
      </div>

      <div class="grinding-tabs-nav">
        <button type="button" class="machining-tab-btn active" data-subtab="polishing-mod-queue"><span class="subtab-icon">📋</span><span class="subtab-label">Queue</span></button>
        <button type="button" class="machining-tab-btn" data-subtab="polishing-mod-active"><span class="subtab-icon">⚡</span><span class="subtab-label">Active Job</span></button>
        <button type="button" class="machining-tab-btn" data-subtab="polishing-mod-history"><span class="subtab-icon">📜</span><span class="subtab-label">History</span></button>
      </div>

      <!-- QUEUE -->
      <div id="polishing-mod-queue" class="machining-subtab-panel active">
        <div class="panel">
          <div class="panel-header">
            <h3>MODULE 01: POLISHING LIVE DEPARTMENT QUEUE</h3>
            <span class="panel-subtitle">Jobs waiting for or running in polishing.</span>
          </div>
          <div class="panel-body">
            <div class="filters-toolbar">
              <div class="filter-group"><label for="polishing-mod-filter-kp">KP No:</label><input type="text" id="polishing-mod-filter-kp" class="form-input input-sm" placeholder="Search KP..."></div>
              <div class="filter-group"><label for="polishing-mod-filter-jc">JC No:</label><input type="text" id="polishing-mod-filter-jc" class="form-input input-sm" placeholder="Search JC..."></div>
              <div class="filter-group"><label for="polishing-mod-filter-customer">Customer:</label><input type="text" id="polishing-mod-filter-customer" class="form-input input-sm" placeholder="Search Customer..."></div>
              <div class="filter-group"><label for="polishing-mod-filter-process">Process:</label>
                <select id="polishing-mod-filter-process" class="form-input select-sm"><option value="">All Processes</option>${opts(PROCESSES)}</select></div>
              <button id="polishing-mod-clear-filters" class="btn btn-secondary btn-sm" style="height:60px; min-width:120px;">CLEAR FILTERS</button>
            </div>
            <div id="polishing-mod-queue-cards" class="queue-cards-grid"></div>
          </div>
        </div>
      </div>

      <!-- ACTIVE JOB -->
      <div id="polishing-mod-active" class="machining-subtab-panel">
        <div class="split-layout">
          <div class="panel active-operation-panel grinding-active-monitor">
            <div class="panel-header header-alert">
              <h3>MODULE 02: ACTIVE POLISHING STATION MONITOR</h3>
              <div class="live-dot-pulse"><span class="pulse-dot"></span><span class="pulse-txt">POLISHING CYCLE</span></div>
            </div>
            <div class="panel-body">
              <div id="polishing-mod-no-active" class="no-selection-message">
                <p>NO ACTIVE POLISHING CYCLE SELECTED</p>
                <span class="sub-text">Select a job from the Queue sub-tab and tap "Start Polishing", or pick a running cycle on the right.</span>
              </div>
              <div id="polishing-mod-station" class="timer-interface-grid" style="display:none;">
                <div class="job-meta-details">
                  <div class="meta-row"><span class="meta-label">KP NUMBER:</span><span id="polishing-mod-a-kp" class="font-bold text-cyan" style="font-size:18px;">-</span></div>
                  <div class="meta-row"><span class="meta-label">COMPONENT PART:</span><span id="polishing-mod-a-part" class="font-bold">-</span></div>
                  <div class="meta-row"><span class="meta-label">CUSTOMER:</span><span id="polishing-mod-a-customer" class="font-bold">-</span></div>
                  <div class="meta-row"><span class="meta-label">BATCH QUANTITY:</span><span id="polishing-mod-a-qty" class="font-bold font-mono text-cyan" style="font-size:18px;">0</span></div>
                  <div class="meta-row"><span class="meta-label">PROCESS:</span><span id="polishing-mod-a-process" class="badge badge-normal font-bold" style="font-size:14px; padding:4px 8px;">-</span></div>
                  <div class="meta-row"><span class="meta-label">STORE LOCATION:</span><span id="polishing-mod-a-location" class="font-bold text-orange" style="font-size:18px;">-</span></div>
                  <div class="meta-row"><span class="meta-label">OPERATOR:</span><span id="polishing-mod-a-operator" class="font-bold" style="font-size:18px; color:#facc15;">-</span></div>
                  <div class="meta-row"><span class="meta-label">CYCLE STATE:</span><span id="polishing-mod-a-state" class="badge badge-progress" style="font-size:14px; padding:4px 8px;">STANDBY</span></div>
                </div>
                <div class="timer-display-box text-center">
                  <span class="meta-label">ELAPSED ACTIVE CYCLE RUNTIME</span>
                  <div class="digital-digits text-cyan" id="polishing-mod-timer">00:00:00</div>
                  <div class="timer-secondary-metrics mt-1 text-muted" style="display:flex; justify-content:center; gap:30px;">
                    <div><span class="timer-sub-lbl">Start: </span><span class="font-mono text-xs" id="polishing-mod-started">--:--:--</span></div>
                    <div><span class="timer-sub-lbl">Paused Time: </span><span class="font-mono text-xs text-red" id="polishing-mod-paused">00:00:00</span></div>
                  </div>
                </div>
                <div class="form-group mt-1">
                  <label for="polishing-mod-remarks">Polishing Remarks / Ra Value (optional)</label>
                  <input type="text" id="polishing-mod-remarks" class="form-input" placeholder="Ra value, finish, compound used, observations...">
                </div>
                <div class="timer-actions-bar mt-1" style="display:flex; gap:15px; width:100%;">
                  <button type="button" class="btn btn-success btn-block glove-btn-lg" id="polishing-mod-btn-start" style="display:none;">START CYCLE</button>
                  <button type="button" class="btn btn-danger btn-block glove-btn-lg" id="polishing-mod-btn-pause" style="display:none;">PAUSE CYCLE</button>
                  <button type="button" class="btn btn-warning btn-block glove-btn-lg" id="polishing-mod-btn-resume" style="display:none;">RESUME CYCLE</button>
                  <button type="button" class="btn btn-primary btn-block glove-btn-lg" id="polishing-mod-btn-end" style="display:none;">END POLISHING</button>
                </div>
              </div>
            </div>
          </div>
          <div class="panel">
            <div class="panel-header"><h3>ACTIVE POLISHING CYCLES</h3></div>
            <div class="panel-body" style="max-height:500px; overflow-y:auto;">
              <div id="polishing-mod-active-cards" class="active-cards-list"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- HISTORY -->
      <div id="polishing-mod-history" class="machining-subtab-panel">
        <div class="panel">
          <div class="panel-header"><h3>MODULE 03: POLISHING JOB CHRONOLOGY LOG</h3></div>
          <div class="panel-body">
            <div class="filters-toolbar">
              <div class="filter-group"><label for="polishing-mod-h-kp">KP No:</label><input type="text" id="polishing-mod-h-kp" class="form-input input-sm" placeholder="Search KP..."></div>
              <div class="filter-group"><label for="polishing-mod-h-customer">Customer:</label><input type="text" id="polishing-mod-h-customer" class="form-input input-sm" placeholder="Search Customer..."></div>
              <div class="filter-group"><label for="polishing-mod-h-process">Process:</label>
                <select id="polishing-mod-h-process" class="form-input select-sm"><option value="">All</option>${opts(PROCESSES)}</select></div>
              <button id="polishing-mod-h-clear" class="btn btn-secondary btn-sm" style="height:60px; min-width:120px;">CLEAR FILTERS</button>
            </div>
            <div style="overflow-x:auto;">
              <table class="data-table mt-1">
                <thead><tr><th>KP Number</th><th>Part Name</th><th>Customer</th><th>Qty</th><th>Process</th><th>Operator</th>
                  <th>Location</th><th>Duration</th><th>Holds</th><th>Now In</th></tr></thead>
                <tbody id="polishing-mod-history-body"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>`;
    while (wrap.firstElementChild) sec.appendChild(wrap.firstElementChild);
  }

  function injectModals() {
    if (P("modal-start")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="polishing-mod-modal-start" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header"><h3>Start Polishing Operation</h3><button type="button" class="modal-close" data-pclose="polishing-mod-modal-start">&times;</button></div>
          <div class="modal-body">
            <p>Set up the polishing cycle for <strong id="polishing-mod-start-kp" class="text-cyan"></strong>.</p>
            <form id="polishing-mod-start-form" class="industrial-form mt-1">
              <div class="form-group">
                <label for="polishing-mod-start-process" style="font-weight:bold; margin-bottom:5px; display:block;">Polishing Process *</label>
                <select id="polishing-mod-start-process" class="form-input" style="height:50px; font-size:16px; width:100%;" required>${opts(PROCESSES)}</select>
              </div>
              <div class="form-grid">
                <div class="form-group">
                  <label for="polishing-mod-start-operator" style="font-weight:bold; margin-bottom:5px; display:block;">Operator Name *</label>
                  <input type="text" id="polishing-mod-start-operator" list="polishing-mod-operator-list" class="form-input" style="height:50px; font-size:16px; width:100%;" placeholder="Type or pick a name" required>
                  <datalist id="polishing-mod-operator-list"></datalist>
                </div>
                <div class="form-group">
                  <label for="polishing-mod-start-qty" style="font-weight:bold; margin-bottom:5px; display:block;">Job Qty (Nos) *</label>
                  <input type="number" id="polishing-mod-start-qty" min="1" class="form-input" style="height:50px; font-size:16px;" required>
                </div>
              </div>
              <div class="form-group">
                <label for="polishing-mod-start-location" style="font-weight:bold; margin-bottom:5px; display:block;">Store Location *</label>
                <select id="polishing-mod-start-location" class="form-input" style="height:50px; font-size:16px; width:100%;" required>${opts(LOCATIONS, LOCATIONS[0])}</select>
              </div>
              <div class="form-actions mt-1" style="flex-direction:column; gap:15px;">
                <button type="submit" class="btn btn-success btn-tablet-primary" style="height:60px; font-size:18px;">Start Polishing Cycle</button>
                <button type="button" class="btn btn-secondary modal-cancel-btn" data-pclose="polishing-mod-modal-start" style="height:60px; font-size:16px; width:100%;">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div id="polishing-mod-modal-pause" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header"><h3>Pause Polishing Operation</h3><button type="button" class="modal-close" data-pclose="polishing-mod-modal-pause">&times;</button></div>
          <div class="modal-body">
            <p>Select a reason to pause polishing for <strong id="polishing-mod-pause-kp" class="text-cyan"></strong>.</p>
            <form id="polishing-mod-pause-form" class="industrial-form mt-1">
              <div class="form-group">
                <label for="polishing-mod-pause-reason" style="font-weight:bold; margin-bottom:5px; display:block;">Select Hold Reason *</label>
                <select id="polishing-mod-pause-reason" class="form-input" style="height:60px; font-size:18px; width:100%;" required>
                  <option value="">-- Select Reason --</option>${opts(HOLD_REASONS)}</select>
              </div>
              <div class="form-group mt-1">
                <label for="polishing-mod-pause-remarks" style="font-weight:bold; margin-bottom:5px; display:block;">Hold Remarks</label>
                <input type="text" id="polishing-mod-pause-remarks" placeholder="Enter details..." class="form-input" style="height:60px; font-size:18px; width:100%;">
              </div>
              <div class="form-actions mt-1" style="flex-direction:column; gap:15px;">
                <button type="submit" class="btn btn-danger btn-tablet-primary" style="height:60px; font-size:18px;">Pause Cycle</button>
                <button type="button" class="btn btn-secondary modal-cancel-btn" data-pclose="polishing-mod-modal-pause" style="height:60px; font-size:16px; width:100%;">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div id="polishing-mod-modal-end" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header"><h3>End Polishing Operation</h3><button type="button" class="modal-close" data-pclose="polishing-mod-modal-end">&times;</button></div>
          <div class="modal-body">
            <p>Complete polishing for <strong id="polishing-mod-end-kp" class="text-cyan"></strong>. Next, drag the job card to its next stage.</p>
            <form id="polishing-mod-end-form" class="industrial-form mt-1">
              <div class="form-group">
                <label for="polishing-mod-end-qty" style="font-weight:bold; margin-bottom:5px; display:block;">Quantity Done in Polishing *</label>
                <input type="number" id="polishing-mod-end-qty" class="form-input" min="1" style="height:60px; font-size:18px; width:100%;" required>
                <span class="text-xs text-muted">If less than the full quantity, the done parts move on and the rest stay in Polishing.</span>
              </div>
              <div class="form-actions mt-1" style="flex-direction:column; gap:15px;">
                <button type="submit" class="btn btn-success btn-tablet-primary" style="height:60px; font-size:18px;">Complete &amp; Choose Next Stage</button>
                <button type="button" class="btn btn-secondary modal-cancel-btn" data-pclose="polishing-mod-modal-end" style="height:60px; font-size:16px; width:100%;">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>`;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
  }

  // ===================== RENDERING =====================
  const polishingJobs = () => allJobs().filter(j => j.currentDepartment === STAGE);

  function renderKpis() {
    const inStage = polishingJobs();
    inStage.forEach(ensurePolishing);
    const pending = inStage.filter(j => j.polishing.status !== "In Progress" && j.polishing.status !== "Hold").length;
    const running = inStage.filter(j => j.polishing.status === "In Progress" || j.polishing.status === "Hold").length;
    const completed = allJobs().filter(j => j.polishing && j.polishing.status === "Completed" && j.currentDepartment !== STAGE);
    const durations = completed.map(j => Number(j.polishing.durationMs || j.polishing.activeTimeMs || 0)).filter(Boolean);
    const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const set = (id, v) => { const el = P(id); if (el) el.textContent = v; };
    set("kpi-pending", pending);
    set("kpi-running", running);
    set("kpi-completed", completed.length);
    set("kpi-avg", fmt(avg));
  }

  function phaseBadge(job) {
    const ph = phaseLabel(job);
    return `<div class="psp-phase-badge ${ph.isPost ? "post" : "pre"}" title="${ph.auto ? "Worked out automatically from whether the job has been sprayed" : "Process chosen by the operator"}">${esc(ph.label)}${ph.auto ? `<span class="psp-phase-auto">(auto)</span>` : ""}</div>`;
  }

  function renderQueue() {
    const box = P("queue-cards");
    if (!box) return;
    const fKp = (P("filter-kp").value || "").toLowerCase();
    const fJc = (P("filter-jc").value || "").toLowerCase();
    const fCust = (P("filter-customer").value || "").toLowerCase();
    const fProc = P("filter-process").value;

    const list = polishingJobs().filter(j => {
      const m = ensurePolishing(j);
      const jc = (typeof getJobJcNo === "function") ? getJobJcNo(j) : (j.jcNo || "");
      if (fKp && !String(j.kpNumber).toLowerCase().includes(fKp)) return false;
      if (fJc && !String(jc).toLowerCase().includes(fJc)) return false;
      if (fCust && !String(j.customer || "").toLowerCase().includes(fCust)) return false;
      if (fProc && phaseLabel(j).label !== fProc) return false;
      return true;
    });

    if (!list.length) {
      box.innerHTML = `<div class="no-selection-message" style="grid-column:1 / -1; width:100%;">No jobs in the Polishing queue.</div>`;
      return;
    }
    const ro = isReadOnly();
    box.innerHTML = "";
    list.forEach(job => {
      const m = job.polishing;
      const running = m.status === "In Progress" || m.status === "Hold";
      const statusClass = m.status === "In Progress" ? "badge-progress" : (m.status === "Hold" ? "badge-hold" : "badge-pending");
      const card = document.createElement("div");
      card.className = "stage-kanban-card";
      if (typeof getTATUrgency === "function") {
        const u = getTATUrgency(job);
        if (u === "warning") card.classList.add("job-card-tat-warning");
        else if (u === "critical") card.classList.add("job-card-tat-critical");
      }
      const actions = ro ? "" : (running
        ? `<button class="btn btn-primary btn-xs" style="width:100%; height:32px;" data-pol-view="${esc(job.kpNumber)}">VIEW STATION</button>`
        : `<button class="btn btn-success btn-xs" style="width:100%; height:32px;" data-pol-start="${esc(job.kpNumber)}">START POLISHING</button>
           <button class="btn btn-secondary btn-xs" style="width:100%; height:28px; font-size:11px;" data-pol-quick="${esc(job.kpNumber)}">Complete &amp; Push Job (no timer)</button>`);
      card.innerHTML = `
        <div class="stage-card-priority-strip ${esc(String(job.priority || "Normal").toLowerCase())}"></div>
        ${phaseBadge(job)}
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
          ${actions}
          ${typeof buildDeleteJobButtonHTML === "function" ? buildDeleteJobButtonHTML(job.kpNumber) : ""}
        </div>`;
      box.appendChild(card);
    });
  }

  function renderStation() {
    const iface = P("station"), empty = P("no-active");
    const job = selectedKp ? allJobs().find(j => j.kpNumber === selectedKp) : null;
    if (!job || job.currentDepartment !== STAGE) {
      selectedKp = null;
      if (iface) iface.style.display = "none";
      if (empty) empty.style.display = "flex";
      return;
    }
    const m = ensurePolishing(job);
    if (empty) empty.style.display = "none";
    if (iface) iface.style.display = "flex";
    P("a-kp").textContent = kpLabel(job);
    P("a-part").textContent = job.partName || "-";
    P("a-customer").textContent = job.customer || "-";
    P("a-qty").innerHTML = qtyLabel(job);
    P("a-process").textContent = m.processType || phaseLabel(job).label;
    P("a-location").textContent = m.location || "-";
    P("a-operator").textContent = m.operatorName || "-";
    const remarks = P("remarks");
    if (remarks && document.activeElement !== remarks) remarks.value = m.remarks || "";
    const st = P("a-state");
    st.className = "badge";
    if (m.status === "In Progress") { st.classList.add("badge-progress"); st.textContent = "RUNNING"; }
    else if (m.status === "Hold") { st.classList.add("badge-hold"); st.textContent = "ON HOLD"; }
    else { st.classList.add("badge-normal"); st.textContent = "STANDBY"; }
    const ro = isReadOnly();
    const show = (id, on) => { const b = P(id); if (b) b.style.display = (on && !ro) ? "flex" : "none"; };
    const running = m.status === "In Progress" || m.status === "Hold";
    show("btn-start", !running);
    show("btn-pause", m.status === "In Progress");
    show("btn-resume", m.status === "Hold");
    show("btn-end", running);
    updateTimer(job);
  }

  function updateTimer(job) {
    const m = ensurePolishing(job);
    const t = P("timer"); if (t) t.textContent = fmt(runningMs(m));
    const s = P("started");
    if (s) s.textContent = m.startTime ? new Date(m.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--";
    const p = P("paused");
    if (p) p.textContent = fmt(m.startTime ? Math.max(0, (Date.now() - new Date(m.startTime).getTime()) - runningMs(m)) : 0);
  }

  function renderActiveCards() {
    const box = P("active-cards");
    if (!box) return;
    const list = polishingJobs().filter(j => { const s = ensurePolishing(j).status; return s === "In Progress" || s === "Hold"; });
    if (!list.length) { box.innerHTML = `<div class="no-selection-message">No running polishing cycles on the shop floor.</div>`; return; }
    box.innerHTML = "";
    list.forEach(job => {
      const m = job.polishing;
      const card = document.createElement("div");
      card.className = "active-card" + (job.kpNumber === selectedKp ? " selected-card" : "");
      card.addEventListener("click", () => { selectedKp = job.kpNumber; render(); });
      card.innerHTML = `
        <div class="card-left">
          <div class="card-kp-row"><span class="card-kp">${esc(kpLabel(job))}</span>
            <span class="badge ${m.status === "Hold" ? "badge-hold" : "badge-progress"} text-xs">${esc(m.status)}</span></div>
          <span class="card-part">${esc(job.partName)} (${qtyLabel(job)})</span>
          <span class="card-op-info">${esc(m.processType || "-")} · ${esc(m.operatorName || "-")}</span>
        </div>
        <div class="card-right"><span class="card-time font-mono" data-pol-timer="${esc(job.kpNumber)}">${fmt(runningMs(m))}</span>
          <span class="text-xs text-muted">Active Run</span></div>`;
      box.appendChild(card);
    });
  }

  function renderHistory() {
    const tbody = P("history-body");
    if (!tbody) return;
    const fKp = (P("h-kp").value || "").toLowerCase();
    const fCust = (P("h-customer").value || "").toLowerCase();
    const fProc = P("h-process").value;
    const list = allJobs().filter(j => {
      const m = j.polishing;
      if (!m || m.status !== "Completed" || j.currentDepartment === STAGE) return false;
      if (fKp && !String(j.kpNumber).toLowerCase().includes(fKp)) return false;
      if (fCust && !String(j.customer || "").toLowerCase().includes(fCust)) return false;
      if (fProc && m.processType !== fProc) return false;
      return true;
    }).sort((a, b) => String(b.polishing.endTime || "").localeCompare(String(a.polishing.endTime || "")));
    if (!list.length) { tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">No completed polishing records.</td></tr>`; return; }
    tbody.innerHTML = list.map(j => {
      const m = j.polishing;
      return `<tr>
        <td class="font-mono font-bold text-cyan">${esc(j.kpNumber)}</td><td>${esc(j.partName)}</td><td>${esc(j.customer)}</td>
        <td class="font-mono">${esc(m.quantity || j.quantity)}</td><td>${esc(m.processType || "-")}</td><td>${esc(m.operatorName || "-")}</td>
        <td>${esc(m.location || "-")}</td><td class="font-mono">${fmt(m.durationMs || m.activeTimeMs)}</td>
        <td>${Array.isArray(m.holdHistory) ? m.holdHistory.length : 0}</td><td><strong>${esc(j.currentDepartment || "-")}</strong></td></tr>`;
    }).join("");
  }

  function render() {
    if (!P("queue")) return;
    renderKpis();
    if (activeSubtab === "polishing-mod-queue") renderQueue();
    else if (activeSubtab === "polishing-mod-active") { renderStation(); renderActiveCards(); }
    else if (activeSubtab === "polishing-mod-history") renderHistory();
  }

  function switchSubtab(id) {
    activeSubtab = id;
    document.querySelectorAll("#tab-polishing .machining-tab-btn").forEach(b => b.classList.toggle("active", b.getAttribute("data-subtab") === id));
    document.querySelectorAll("#tab-polishing .machining-subtab-panel").forEach(p => p.classList.toggle("active", p.id === id));
    render();
  }

  // ===================== ACTIONS =====================
  const openModal = id => { const m = $(id); if (m) m.classList.add("active"); };
  const closeModal = id => { const m = $(id); if (m) m.classList.remove("active"); };

  function openStart(kp) {
    const job = allJobs().find(j => j.kpNumber === kp);
    if (!job) return;
    selectedKp = kp;
    P("start-kp").textContent = kp;
    P("start-process").value = phaseLabel(job).label;
    const dl = P("operator-list");
    if (dl) dl.innerHTML = knownOperators().map(n => `<option value="${esc(n)}"></option>`).join("");
    const u = user();
    P("start-operator").value = (u && u.role === "operator" && u.name) ? u.name : "";
    P("start-qty").value = job.quantity;
    P("start-location").value = (job.polishing && job.polishing.location) || LOCATIONS[0];
    openModal("polishing-mod-modal-start");
  }

  function submitStart(e) {
    e.preventDefault();
    const kp = P("start-kp").textContent;
    const process = P("start-process").value;
    const operator = P("start-operator").value.trim();
    const qty = parseInt(P("start-qty").value, 10);
    const location = P("start-location").value;
    if (!operator) { alert("Please enter the operator name."); return; }
    const job = allJobs().find(j => j.kpNumber === kp);
    if (!job) return;
    const m = ensurePolishing(job);
    const now = new Date().toISOString();
    Object.assign(m, { status: "In Progress", processType: process, operatorName: operator, location,
                       quantity: qty || job.quantity, startTime: now, lastStartedAt: now, activeTimeMs: 0, holdHistory: [] });
    job.status = "In Progress";
    selectedKp = kp;
    closeModal("polishing-mod-modal-start");
    switchSubtab("polishing-mod-active");
    renderAll();
    audit(kp, `Started Polishing (${process}) at ${location}, operator ${operator}`);
    syncToServer({ type: "START_CYCLE", kpNo: kp, stage: STAGE, operatorName: operator, startTime: now,
                   processType: process, location, quantity: qty || job.quantity }, "polishing start");
  }

  function openPause() {
    if (!selectedKp) return;
    P("pause-kp").textContent = selectedKp;
    P("pause-reason").value = "";
    P("pause-remarks").value = "";
    openModal("polishing-mod-modal-pause");
  }

  function submitPause(e) {
    e.preventDefault();
    const reason = P("pause-reason").value, remarks = P("pause-remarks").value;
    if (!reason) { alert("Please select a hold reason."); return; }
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    const m = ensurePolishing(job);
    if (m.status !== "In Progress") { closeModal("polishing-mod-modal-pause"); return; }
    const now = new Date().toISOString();
    m.activeTimeMs = runningMs(m);
    m.status = "Hold";
    m.lastPausedAt = now;
    m.lastStartedAt = null;
    m.holdHistory.push({ holdTime: now, resumeTime: null, reason, remarks });
    job.status = "Hold";
    closeModal("polishing-mod-modal-pause");
    renderAll();
    audit(job.kpNumber, `Paused Polishing. Reason: ${reason}. ${remarks}`);
    syncToServer({ type: "PAUSE_CYCLE", kpNo: job.kpNumber, stage: STAGE, operatorName: m.operatorName,
                   activeTimeMs: m.activeTimeMs, holdHistory: m.holdHistory, holdReason: reason, remarks }, "polishing pause");
  }

  function resume() {
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    const m = ensurePolishing(job);
    if (m.status !== "Hold") return;
    const now = new Date().toISOString();
    m.status = "In Progress";
    m.lastStartedAt = now;
    const last = m.holdHistory[m.holdHistory.length - 1];
    if (last && !last.resumeTime) last.resumeTime = now;
    job.status = "In Progress";
    renderAll();
    audit(job.kpNumber, "Resumed Polishing");
    syncToServer({ type: "RESUME_CYCLE", kpNo: job.kpNumber, stage: STAGE, operatorName: m.operatorName,
                   holdHistory: m.holdHistory }, "polishing resume");
  }

  function openEnd() {
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    P("end-kp").textContent = kpLabel(job);
    const q = P("end-qty");
    q.value = job.quantity;
    q.max = job.quantity;
    openModal("polishing-mod-modal-end");
  }

  function submitEnd(e) {
    e.preventDefault();
    const job = allJobs().find(j => j.kpNumber === selectedKp);
    if (!job) return;
    const m = ensurePolishing(job);
    const doneQty = parseInt(P("end-qty").value, 10);
    if (isNaN(doneQty) || doneQty <= 0 || doneQty > job.quantity) {
      alert(`Please enter a valid quantity done (1 to ${job.quantity}).`);
      return;
    }
    const remarksEl = P("remarks");
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
          processType: m.processType, location: m.location, remarks: m.remarks,
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
    closeModal("polishing-mod-modal-end");
    audit(job.kpNumber, `Completed Polishing (${m.processType || "-"}, ${doneQty}/${job.quantity} pcs)`);
    showFloatingCardTransition(job, STAGE, payloadGenerator, applyLocalMutation);
  }

  // ===================== EVENTS & HOOKS =====================
  function bindEvents() {
    document.querySelectorAll("#tab-polishing .machining-tab-btn").forEach(b =>
      b.addEventListener("click", () => switchSubtab(b.getAttribute("data-subtab"))));
    ["filter-kp", "filter-jc", "filter-customer"].forEach(id => P(id).addEventListener("input", renderQueue));
    P("filter-process").addEventListener("change", renderQueue);
    P("clear-filters").addEventListener("click", () => {
      ["filter-kp", "filter-jc", "filter-customer", "filter-process"].forEach(id => { P(id).value = ""; });
      renderQueue();
    });
    ["h-kp", "h-customer"].forEach(id => P(id).addEventListener("input", renderHistory));
    P("h-process").addEventListener("change", renderHistory);
    P("h-clear").addEventListener("click", () => { ["h-kp", "h-customer", "h-process"].forEach(id => { P(id).value = ""; }); renderHistory(); });

    P("queue-cards").addEventListener("click", e => {
      const start = e.target.closest("[data-pol-start]");
      const view = e.target.closest("[data-pol-view]");
      const quick = e.target.closest("[data-pol-quick]");
      if (start) openStart(start.getAttribute("data-pol-start"));
      if (view) { selectedKp = view.getAttribute("data-pol-view"); switchSubtab("polishing-mod-active"); }
      if (quick && typeof triggerPolishingFloatingTransition === "function") triggerPolishingFloatingTransition(quick.getAttribute("data-pol-quick"));
    });
    P("btn-start").addEventListener("click", () => { if (selectedKp) openStart(selectedKp); });
    P("btn-pause").addEventListener("click", openPause);
    P("btn-resume").addEventListener("click", resume);
    P("btn-end").addEventListener("click", openEnd);
    P("start-form").addEventListener("submit", submitStart);
    P("pause-form").addEventListener("submit", submitPause);
    P("end-form").addEventListener("submit", submitEnd);
    document.querySelectorAll("[data-pclose]").forEach(b => b.addEventListener("click", () => closeModal(b.getAttribute("data-pclose"))));

    setInterval(() => {
      const pane = $("tab-polishing");
      if (!pane || !pane.classList.contains("active")) return;
      if (selectedKp) { const job = allJobs().find(j => j.kpNumber === selectedKp); if (job && job.polishing) updateTimer(job); }
      document.querySelectorAll("[data-pol-timer]").forEach(el => {
        const job = allJobs().find(j => j.kpNumber === el.getAttribute("data-pol-timer"));
        if (job && job.polishing) el.textContent = fmt(runningMs(job.polishing));
      });
    }, 1000);
  }

  function installHooks() {
    if (typeof window.executeRenderAll === "function") {
      const orig = window.executeRenderAll;
      window.executeRenderAll = function () {
        const r = orig.apply(this, arguments);
        try {
          const pane = $("tab-polishing");
          if (pane && pane.classList.contains("active")) render();
        } catch (e) { console.warn("[Polishing] render error:", e); }
        return r;
      };
    }
  }

  // ===================== BOOT =====================
  try {
    injectTab();
    injectModals();
    bindEvents();
    installHooks();
    window.PSPPolishing = { render };
    console.log("[PSP] polishing v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] polishing failed to load:", err);
  }
})();
