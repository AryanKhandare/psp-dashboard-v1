/**
 * PSP MES – Quarantine (last tab). Any job can be moved here from any stage, always with a reason.
 *
 *  - "⛔ Quarantine" target on the Select Next Stage screen, in every Next Department list, FIR / Outsourcing
 *    "Send job to", and the QUARANTINE column on the main board. PIR "Blank PIR/Quarantine" moves the job here too.
 *  - Every move into Quarantine asks for a reason (+ remarks); the source stage, time and user are saved.
 *  - Quarantine tab: Queue (Release → any stage, Delete Job) and History (all quarantine episodes).
 *  - Firebase: job.quarantine (current) + job.quarantineLog (all episodes, added on release).
 *
 * Load after stage-board.js, pir-form.js, fir-form.js and outsourcing.js, before app.js.
 */
(function () {
  if (!window.PSP) { console.error("[PSP] quarantine: psp-common.js must load first."); return; }
  const { $, esc, opts, allJobs, user, isReadOnly, kpLabel, qtyLabel } = window.PSP;
  const MODULE_VERSION = 1;

  const STAGE = "Quarantine";
  const REASONS = ["Blank PIR", "Quality issue / NCR", "Customer query / clearance", "Damaged / rejected material", "Awaiting drawing / specification", "Other"];
  const RETURN_STAGES = ["Inspection", "Machining", "Masking", "Blasting", "Spraying", "Sealing", "Grinding", "Polishing", "Final Inspection", "Dispatch", "Outsourcing"];
  const INSPECTION_OPERATORS_ALLOWED = true;   // inspectors (Inspection-department operators) get this tab
  let activeSubtab = "qtn-subtab-queue";

  const me = () => { const u = user() || {}; return u.name || u.email || "User"; };
  const toDate = v => { if (!v) return null; const d = (v && typeof v.toDate === "function") ? v.toDate() : new Date(v); return isNaN(d.getTime()) ? null : d; };
  const fmtDT = v => { const d = toDate(v); return d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) + ", " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"; };
  const daysSince = v => { const d = toDate(v); return d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)) : null; };
  const qOf = job => (job.quarantine && typeof job.quarantine === "object") ? job.quarantine : {};
  const qJobs = () => allJobs().filter(j => j.currentDepartment === STAGE);
  function audit(kp, text) { try { if (typeof createAuditLog === "function") createAuditLog((user() || {}).email || me(), kp, text); } catch (e) {} }
  async function findRef(kp) {
    const job = allJobs().find(j => j.kpNumber === kp);
    const db = firebase.firestore();
    const snap = await db.collection("jobs").where("kpNumber", "==", kp).get();
    const live = snap.docs.find(d => d.data().isDeleted !== true);
    if (live) return { ref: live.ref, data: live.data() };
    if (job && job.id) return { ref: db.collection("jobs").doc(job.id), data: null };
    return null;
  }

  // ---------- live Firebase copy of quarantine fields ----------
  const fsQ = new Map();
  let fsStarted = false;
  function applyFirebase() {
    allJobs().forEach(job => {
      const f = fsQ.get(job.kpNumber);
      if (!f) return;
      if (f.quarantine && (!job.quarantine || !job.quarantine._local)) job.quarantine = JSON.parse(JSON.stringify(f.quarantine));
      if (Array.isArray(f.quarantineLog)) job.quarantineLog = f.quarantineLog;
    });
  }
  function startListeners() {
    if (fsStarted) return;
    if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length) return;
    if (typeof isMockMode === "function" && isMockMode()) return;
    let au = null; try { au = firebase.auth().currentUser; } catch (e) { return; }
    if (!au || au.isAnonymous) return;
    fsStarted = true;
    const db = firebase.firestore();
    const onSnap = snap => {
      snap.docChanges().forEach(ch => {
        const d = ch.doc.data();
        if (d.kpNumber) fsQ.set(d.kpNumber, { quarantine: d.quarantine || null, quarantineLog: d.quarantineLog || [] });
      });
      applyFirebase();
      if (typeof renderAll === "function") renderAll();
    };
    const onErr = e => console.warn("[Quarantine] listener:", e && e.message ? e.message : e);
    db.collection("jobs").where("currentStage", "==", STAGE).onSnapshot(onSnap, onErr);
    db.collection("jobs").where("quarantine.status", "==", "Released").onSnapshot(onSnap, onErr);
  }

  // ===================== UI =====================
  function injectSidebar() {
    const after = $("nav-btn-outsourcing") || $("nav-btn-dispatch");
    if (!after || $("nav-btn-quarantine")) return;
    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.id = "nav-btn-quarantine";
    btn.setAttribute("data-tab", "tab-quarantine");
    btn.innerHTML = `<span class="stage-num" style="background:#7f1d1d; color:#fff;">QTN</span><span class="stage-name">Quarantine</span>
                     <span class="stage-badge badge-hold" id="badge-count-quarantine">0</span>`;
    btn.addEventListener("click", () => { window.location.hash = "#/quarantine"; });
    after.insertAdjacentElement("afterend", btn);
  }

  function injectStageTargets() {
    const last = $("target-zone-outsourcing") || $("target-zone-dispatch");
    if (last && !$("target-zone-quarantine")) {
      const z = document.createElement("div");
      z.className = "drop-target-stage";
      z.id = "target-zone-quarantine";
      z.setAttribute("data-target-stage", STAGE);
      z.innerHTML = `<span class="drop-icon">⛔</span><span class="drop-label">Quarantine</span>`;
      last.insertAdjacentElement("afterend", z);
    }
    ["spraying-complete-next-process", "grinding-complete-next-process", "masking-complete-next-process",
     "masking-next-process", "no-masking-next-process", "out-rnext", "fir-next"].forEach(id => {
      const s = $(id);
      if (!s || s.querySelector(`option[value="${STAGE}"]`)) return;
      const o = document.createElement("option"); o.value = STAGE; o.textContent = STAGE; s.appendChild(o);
    });
  }

  function injectTab() {
    const main = document.querySelector(".mes-main-content");
    if (!main || $("tab-quarantine")) return;
    const sec = document.createElement("section");
    sec.id = "tab-quarantine";
    sec.className = "tab-pane";
    sec.innerHTML = `
      <div class="masking-dashboard-header"><div class="section-title-wrapper">
        <h2>QUARANTINE</h2>
        <p class="section-desc">Jobs held from any stage for a reason (blank PIR, quality issue, customer query…). Release a job back to any stage.</p>
      </div></div>
      <div class="grinding-kpis-grid" style="grid-template-columns:repeat(3,1fr); margin-bottom:20px;">
        <div class="metric-card" style="border:2px solid #b91c1c;"><span class="metric-val" id="qtn-kpi-now" style="color:#dc2626;">0</span><span class="metric-lbl">In Quarantine</span></div>
        <div class="metric-card"><span class="metric-val text-orange" id="qtn-kpi-old">0</span><span class="metric-lbl">More than 7 days</span></div>
        <div class="metric-card"><span class="metric-val text-green" id="qtn-kpi-released">0</span><span class="metric-lbl">Released (30 days)</span></div>
      </div>
      <div class="grinding-tabs-nav">
        <button type="button" class="machining-tab-btn active" data-qtn-subtab="qtn-subtab-queue"><span class="subtab-icon">⛔</span><span class="subtab-label">In Quarantine</span></button>
        <button type="button" class="machining-tab-btn" data-qtn-subtab="qtn-subtab-history"><span class="subtab-icon">📜</span><span class="subtab-label">History</span></button>
      </div>
      <div id="qtn-subtab-queue" class="machining-subtab-panel active">
        <div class="panel"><div class="panel-body">
          <div class="filters-toolbar">
            <div class="filter-group"><label for="qtn-filter-text">Search:</label><input type="text" id="qtn-filter-text" class="form-input input-sm" placeholder="KP, JC, customer, reason..."></div>
            <div class="filter-group"><label for="qtn-filter-reason">Reason:</label><select id="qtn-filter-reason" class="form-input select-sm"><option value="">All</option>${opts(REASONS)}</select></div>
            <button id="qtn-filter-clear" class="btn btn-secondary btn-sm" style="height:60px; min-width:120px;">CLEAR FILTERS</button>
          </div>
          <div id="qtn-queue-cards" class="queue-cards-grid"></div>
        </div></div>
      </div>
      <div id="qtn-subtab-history" class="machining-subtab-panel">
        <div class="panel"><div class="panel-body">
          <div class="filters-toolbar"><div class="filter-group"><label for="qtn-hist-text">Search:</label><input type="text" id="qtn-hist-text" class="form-input input-sm" placeholder="KP, customer, reason..."></div></div>
          <div style="overflow-x:auto;"><table class="data-table mt-1">
            <thead><tr><th>KP Number</th><th>Part Name</th><th>Customer</th><th>From Stage</th><th>Reason</th><th>Remarks</th>
              <th>Quarantined On</th><th>By</th><th>Released On</th><th>Released By</th><th>Days Held</th><th>Released To</th></tr></thead>
            <tbody id="qtn-history-body"></tbody></table></div>
        </div></div>
      </div>`;
    main.appendChild(sec);
  }

  function injectModals() {
    if ($("qtn-modal-in")) return;
    const css = 'class="form-input" style="height:48px; font-size:16px; width:100%;"';
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="qtn-modal-in" class="modal-overlay" style="z-index:12600;"><div class="modal-content">
        <div class="modal-header"><h3>⛔ Move to Quarantine</h3><button type="button" class="modal-close" data-qtn-close="in">&times;</button></div>
        <div class="modal-body">
          <p id="qtn-in-info"></p>
          <form id="qtn-in-form" class="industrial-form mt-1">
            <div class="form-group"><label for="qtn-reason" style="font-weight:bold; display:block; margin-bottom:5px;">Reason *</label>
              <select id="qtn-reason" ${css} required><option value="">-- Select reason --</option>${opts(REASONS)}</select></div>
            <div class="form-group"><label for="qtn-remarks" style="font-weight:bold; display:block; margin-bottom:5px;">Remarks <span id="qtn-remarks-req" style="color:#ef4444;"></span></label>
              <textarea id="qtn-remarks" class="form-input" style="min-height:80px; font-size:15px; width:100%;" placeholder="What is the problem? What is needed to release it?"></textarea></div>
            <div class="form-actions mt-1" style="flex-direction:column; gap:12px;">
              <button type="submit" class="btn btn-danger btn-tablet-primary" style="height:56px; font-size:17px;">⛔ Move to Quarantine</button>
              <button type="button" class="btn btn-secondary modal-cancel-btn" data-qtn-close="in" style="height:52px; width:100%;">Cancel</button>
            </div>
          </form>
        </div></div></div>
      <div id="qtn-modal-out" class="modal-overlay"><div class="modal-content">
        <div class="modal-header"><h3>Release from Quarantine</h3><button type="button" class="modal-close" data-qtn-close="out">&times;</button></div>
        <div class="modal-body">
          <p id="qtn-out-info"></p>
          <form id="qtn-out-form" class="industrial-form mt-1">
            <div class="form-group"><label for="qtn-next" style="font-weight:bold; display:block; margin-bottom:5px;">Send job to *</label>
              <select id="qtn-next" ${css} required>${opts(RETURN_STAGES)}</select>
              <div id="qtn-next-hint" class="text-xs text-muted" style="margin-top:4px;"></div></div>
            <div class="form-group"><label for="qtn-out-remarks" style="font-weight:bold; display:block; margin-bottom:5px;">Release remarks</label>
              <textarea id="qtn-out-remarks" class="form-input" style="min-height:70px; font-size:15px; width:100%;" placeholder="How was it resolved?"></textarea></div>
            <div class="form-actions mt-1" style="flex-direction:column; gap:12px;">
              <button type="submit" id="qtn-out-submit" class="btn btn-success btn-tablet-primary" style="height:56px; font-size:17px;">Release</button>
              <button type="button" class="btn btn-secondary modal-cancel-btn" data-qtn-close="out" style="height:52px; width:100%;">Cancel</button>
            </div>
          </form>
        </div></div></div>`;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
  }

  // ===================== RENDER =====================
  function allEpisodes() {
    const out = [];
    allJobs().forEach(j => (Array.isArray(j.quarantineLog) ? j.quarantineLog : []).forEach(t => out.push(Object.assign({ job: j }, t))));
    return out.sort((a, b) => String(b.releasedAt || "").localeCompare(String(a.releasedAt || "")));
  }
  function renderKpis() {
    const list = qJobs();
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("qtn-kpi-now", list.length);
    set("qtn-kpi-old", list.filter(j => (daysSince(qOf(j).at) || 0) > 7).length);
    const cutoff = Date.now() - 30 * 86400000;
    set("qtn-kpi-released", allEpisodes().filter(t => { const d = toDate(t.releasedAt); return d && d.getTime() >= cutoff; }).length);
    const b = $("badge-count-quarantine"); if (b) b.textContent = list.length;
  }
  function renderQueue() {
    const box = $("qtn-queue-cards");
    if (!box) return;
    const q = ($("qtn-filter-text").value || "").toLowerCase(), r = $("qtn-filter-reason").value;
    const list = qJobs().filter(j => {
      const o = qOf(j);
      if (r && o.reason !== r) return false;
      const jc = typeof getJobJcNo === "function" ? getJobJcNo(j) : (j.jcNo || "");
      return !q || [j.kpNumber, jc, j.customer, j.partName, o.reason, o.remarks].some(v => String(v || "").toLowerCase().includes(q));
    }).sort((a, b) => String(qOf(a).at || "").localeCompare(String(qOf(b).at || "")));
    if (!list.length) { box.innerHTML = `<div class="no-selection-message" style="grid-column:1 / -1; width:100%;">No jobs in Quarantine.</div>`; return; }
    const ro = isReadOnly();
    box.innerHTML = list.map(job => {
      const o = qOf(job), days = daysSince(o.at);
      return `<div class="stage-kanban-card" style="border:2px solid #b91c1c;">
          <div class="stage-card-priority-strip critical"></div>
          <div class="job-card-header" style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
            <span class="font-mono font-bold text-cyan" style="font-size:14px;">${esc(kpLabel(job))}</span>
            <span class="badge" style="background:#b91c1c; color:#fff; font-size:10px;">⛔ QUARANTINE${days !== null ? ` · ${days} d` : ""}</span></div>
          <div class="job-card-body" style="font-size:12px; display:flex; flex-direction:column; gap:4px; margin-bottom:12px;">
            <div class="job-card-row"><span class="job-card-label">Part Name:</span><span class="job-card-value">${esc(job.partName)}</span></div>
            <div class="job-card-row"><span class="job-card-label">Customer:</span><span class="job-card-value">${esc(job.customer)}</span></div>
            <div class="job-card-row"><span class="job-card-label">Quantity:</span><span class="job-card-value font-mono">${qtyLabel(job)}</span></div>
            <div class="job-card-row"><span class="job-card-label">From Stage:</span><span class="job-card-value">${esc(o.fromStage || "—")}</span></div>
            <div class="job-card-row"><span class="job-card-label">Reason:</span><span class="job-card-value" style="color:#dc2626; font-weight:800;">${esc(o.reason || "—")}</span></div>
            ${o.remarks ? `<div class="job-card-row"><span class="job-card-label">Remarks:</span><span class="job-card-value">${esc(o.remarks)}</span></div>` : ""}
            <div class="job-card-row"><span class="job-card-label">Since:</span><span class="job-card-value">${fmtDT(o.at)}${o.by ? " · " + esc(o.by) : ""}</span></div>
          </div>
          <div class="stage-card-actions" style="border-top:1px solid rgba(255,255,255,0.05); padding-top:10px; display:flex; flex-direction:column; gap:8px;">
            ${ro ? "" : `<button class="btn btn-success btn-xs" style="width:100%; height:34px;" data-qtn-release="${esc(job.kpNumber)}">RELEASE FROM QUARANTINE</button>`}
            ${typeof buildDeleteJobButtonHTML === "function" ? buildDeleteJobButtonHTML(job.kpNumber) : ""}
          </div></div>`;
    }).join("");
  }
  function renderHistory() {
    const tbody = $("qtn-history-body");
    if (!tbody) return;
    const q = ($("qtn-hist-text").value || "").toLowerCase();
    const list = allEpisodes().filter(t => !q || [t.job.kpNumber, t.job.customer, t.reason, t.remarks].some(v => String(v || "").toLowerCase().includes(q)));
    tbody.innerHTML = list.length ? list.map(t => {
      const a = toDate(t.at), r = toDate(t.releasedAt);
      return `<tr><td class="font-mono font-bold text-cyan">${esc(t.job.kpNumber)}</td><td>${esc(t.job.partName)}</td><td>${esc(t.job.customer)}</td>
        <td>${esc(t.fromStage || "—")}</td><td style="color:#dc2626; font-weight:700;">${esc(t.reason || "—")}</td><td>${esc(t.remarks || "")}</td>
        <td style="white-space:nowrap;">${fmtDT(t.at)}</td><td>${esc(t.by || "—")}</td><td style="white-space:nowrap;">${fmtDT(t.releasedAt)}</td><td>${esc(t.releasedBy || "—")}</td>
        <td class="font-mono">${a && r ? Math.max(0, Math.floor((r - a) / 86400000)) + " d" : "—"}</td><td><strong>${esc(t.releasedTo || "—")}</strong></td></tr>`;
    }).join("") : `<tr><td colspan="12" class="text-center text-muted">No quarantine history yet.</td></tr>`;
  }
  function render() {
    renderKpis();
    const pane = $("tab-quarantine");
    if (!pane || !pane.classList.contains("active")) return;
    if (activeSubtab === "qtn-subtab-queue") renderQueue(); else renderHistory();
  }

  // ===================== INTO QUARANTINE (reason required) =====================
  let pendingIn = null;     // { transition, target }
  let preset = null;        // reason given by another form (e.g. PIR "Blank PIR")
  let bypass = false;

  function openReason(tr) {
    pendingIn = { transition: tr };
    $("qtn-in-info").innerHTML = `<strong class="text-cyan">${esc(kpLabel(tr.job))}</strong> · ${esc(tr.job.partName || "")} · from <strong>${esc(tr.stage)}</strong>`;
    $("qtn-reason").value = ""; $("qtn-remarks").value = ""; $("qtn-remarks-req").textContent = "";
    $("qtn-modal-in").classList.add("active");
  }
  // After the move, write the quarantine record onto the job that landed in Quarantine (the split part if qty was partial)
  function recordIn(getKp, info) {
    let tries = 0;
    const attempt = async () => {
      tries++;
      const kp = getKp();
      const local = allJobs().find(j => j.kpNumber === kp);
      if (local) local.quarantine = Object.assign({ _local: true }, info);
      if (typeof isMockMode === "function" && isMockMode()) return;
      try {
        const f = await findRef(kp);
        if (f && f.data && f.data.currentStage === STAGE) {
          await f.ref.update({ quarantine: info, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() });
          if (local && local.quarantine) delete local.quarantine._local;
          audit(kp, `Moved to QUARANTINE from ${info.fromStage}: ${info.reason}${info.remarks ? " – " + info.remarks : ""}`);
          if (typeof renderAll === "function") renderAll();
          return;
        }
      } catch (e) { console.warn("[Quarantine] record:", e && e.message ? e.message : e); }
      if (tries < 30) setTimeout(attempt, 2000);
    };
    setTimeout(attempt, 1200);
  }
  function doMoveIn(tr, reason, remarks) {
    const info = { status: "In Quarantine", reason, remarks: remarks || "", fromStage: tr.stage, at: new Date().toISOString(), by: me() };
    let movedKp = tr.job.kpNumber;
    const gen = tr.payloadGenerator;
    tr.payloadGenerator = ns => { const p = gen(ns); if (p && p.splitKp) movedKp = p.splitKp; return p; };
    window.pendingTransition = tr;
    bypass = true;
    try { origApply(STAGE); } finally { bypass = false; }
    recordIn(() => movedKp, info);
  }

  let origApply = null;
  function installApplyHook() {
    if (typeof window.applyStageTransitionWithUndo !== "function") return;
    origApply = window.applyStageTransitionWithUndo;
    window.applyStageTransitionWithUndo = function (targetStage) {
      const tr = window.pendingTransition;
      if (!bypass && targetStage === STAGE && tr && tr.job && tr.stage !== STAGE) {
        if (preset) { const p = preset; preset = null; doMoveIn(tr, p.reason, p.remarks); return; }
        openReason(tr);
        return;
      }
      return origApply.apply(this, arguments);
    };
  }

  // ===================== OUT OF QUARANTINE =====================
  let current = null;
  function openRelease(kp) {
    const job = allJobs().find(j => j.kpNumber === kp); if (!job) return;
    current = job;
    const o = qOf(job);
    $("qtn-out-info").innerHTML = `<strong class="text-cyan">${esc(kpLabel(job))}</strong> · reason: <strong style="color:#dc2626;">${esc(o.reason || "—")}</strong>${o.at ? " · since " + fmtDT(o.at) : ""}`;
    $("qtn-next").value = RETURN_STAGES.includes(o.fromStage) ? o.fromStage : "Inspection";
    $("qtn-next-hint").textContent = o.fromStage ? `It came from ${o.fromStage}.` : "";
    $("qtn-out-remarks").value = "";
    $("qtn-out-submit").textContent = `Release & Move to ${$("qtn-next").value}`;
    $("qtn-modal-out").classList.add("active");
  }
  async function submitRelease(e) {
    e.preventDefault();
    const job = current; if (!job) return;
    const next = $("qtn-next").value, rem = $("qtn-out-remarks").value.trim();
    const o = qOf(job);
    const ep = { fromStage: o.fromStage || "", reason: o.reason || "", remarks: o.remarks || "", at: o.at || "", by: o.by || "",
                 releasedAt: new Date().toISOString(), releasedBy: me(), releaseRemarks: rem, releasedTo: next };
    const newQ = Object.assign({}, o, { status: "Released", releasedAt: ep.releasedAt, releasedBy: ep.releasedBy, releaseRemarks: rem, releasedTo: next });
    delete newQ._local;
    job.quarantine = newQ;
    job.quarantineLog = (Array.isArray(job.quarantineLog) ? job.quarantineLog : []).concat([ep]);
    $("qtn-modal-out").classList.remove("active");
    try {
      if (!(typeof isMockMode === "function" && isMockMode())) {
        const f = await findRef(job.kpNumber);
        if (f) await f.ref.update({ quarantine: newQ, quarantineLog: firebase.firestore.FieldValue.arrayUnion(ep) });
      }
    } catch (err) { alert("Could not save the release: " + (err && err.message ? err.message : err)); return; }
    audit(job.kpNumber, `Released from QUARANTINE → ${next}${rem ? " (" + rem + ")" : ""}`);
    const op = me();
    window.pendingTransition = {
      job, stage: STAGE,
      payloadGenerator: ns => ({ type: "MOVE_STAGE", kpNo: job.kpNumber, stage: STAGE, nextStage: ns, operatorName: op, stopRunningCycle: false, time: new Date().toISOString() }),
      applyLocalMutation: ns => { if (typeof transitionToStage === "function") transitionToStage(job, ns, op); else job.currentDepartment = ns; }
    };
    window.applyStageTransitionWithUndo(next);
  }

  // ===================== HOOKS =====================
  function installHooks() {
    if (typeof ROLE_PERMISSIONS !== "undefined") {
      ["super_admin", "production_admin", "hr_admin", "quality_admin"].forEach(r => {
        const l = ROLE_PERMISSIONS[r];
        if (Array.isArray(l) && !l.includes("tab-quarantine")) l.push("tab-quarantine");
      });
    }
    if (typeof window.isTabAuthorized === "function" && INSPECTION_OPERATORS_ALLOWED) {
      const origAuth = window.isTabAuthorized;
      window.isTabAuthorized = function (tabId) {
        if (tabId === "tab-quarantine") {
          const u = user();
          if (u && u.role === "operator") {
            const dept = typeof getCleanDeptKey === "function" ? getCleanDeptKey(u.department) : u.department;
            if (dept === "Inspection") return true;
          }
        }
        return origAuth.apply(this, arguments);
      };
    }
    installApplyHook();
    if (typeof window.executeRenderAll === "function") {
      const orig = window.executeRenderAll;
      window.executeRenderAll = function () {
        try { startListeners(); applyFirebase(); injectStageTargets(); } catch (e) {}
        const r = orig.apply(this, arguments);
        try { render(); } catch (e) { console.warn("[Quarantine] render:", e); }
        return r;
      };
    }
  }

  function bindEvents() {
    document.querySelectorAll("#tab-quarantine [data-qtn-subtab]").forEach(b => b.addEventListener("click", () => {
      activeSubtab = b.getAttribute("data-qtn-subtab");
      document.querySelectorAll("#tab-quarantine [data-qtn-subtab]").forEach(x => x.classList.toggle("active", x === b));
      document.querySelectorAll("#tab-quarantine .machining-subtab-panel").forEach(p => p.classList.toggle("active", p.id === activeSubtab));
      render();
    }));
    $("qtn-filter-text").addEventListener("input", renderQueue);
    $("qtn-filter-reason").addEventListener("change", renderQueue);
    $("qtn-filter-clear").addEventListener("click", () => { $("qtn-filter-text").value = ""; $("qtn-filter-reason").value = ""; renderQueue(); });
    $("qtn-hist-text").addEventListener("input", renderHistory);
    $("qtn-queue-cards").addEventListener("click", e => { const b = e.target.closest("[data-qtn-release]"); if (b) openRelease(b.getAttribute("data-qtn-release")); });
    $("qtn-reason").addEventListener("change", () => { $("qtn-remarks-req").textContent = $("qtn-reason").value === "Other" ? "* (required for Other)" : ""; });
    $("qtn-in-form").addEventListener("submit", e => {
      e.preventDefault();
      const reason = $("qtn-reason").value, remarks = $("qtn-remarks").value.trim();
      if (!reason) { alert("Please choose the reason."); return; }
      if (reason === "Other" && !remarks) { alert("Please write the remarks for 'Other'."); return; }
      $("qtn-modal-in").classList.remove("active");
      const p = pendingIn; pendingIn = null;
      if (p) doMoveIn(p.transition, reason, remarks);
    });
    $("qtn-out-form").addEventListener("submit", submitRelease);
    $("qtn-next").addEventListener("change", () => { $("qtn-out-submit").textContent = `Release & Move to ${$("qtn-next").value}`; });
    document.querySelectorAll("[data-qtn-close]").forEach(b => b.addEventListener("click", () => {
      const which = b.getAttribute("data-qtn-close");
      $(which === "in" ? "qtn-modal-in" : "qtn-modal-out").classList.remove("active");
      if (which === "in") {   // cancelled: the job stays where it was
        pendingIn = null;
        const overlay = $("transition-drag-overlay"); if (overlay) overlay.style.display = "none";
        window.pendingTransition = null;
        if (typeof renderAll === "function") renderAll();
      }
    }));
  }

  try {
    injectSidebar();
    injectStageTargets();
    injectTab();
    injectModals();
    installHooks();
    bindEvents();
    const wait = setInterval(() => { try { startListeners(); } catch (e) {} if (fsStarted) clearInterval(wait); }, 1500);
    // Other forms can move a job into Quarantine with a reason already known (e.g. PIR "Blank PIR")
    window.PSPQuarantine = { render, setNextReason: (reason, remarks) => { preset = { reason, remarks: remarks || "" }; } };
    console.log("[PSP] quarantine v" + MODULE_VERSION + " loaded.");
  } catch (err) {
    console.error("[PSP] quarantine failed to load:", err);
  }
})();
